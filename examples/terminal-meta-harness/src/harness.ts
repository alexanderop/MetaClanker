import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

import type { EventStore, Provider, StoredEvent } from "./store.js";

type HarnessEvent =
  | { readonly kind: "agent_message"; readonly payload: { readonly text: string } }
  | { readonly kind: "agent_thought"; readonly payload: { readonly text: string } }
  | { readonly kind: "user_message"; readonly payload: { readonly text: string } }
  | {
      readonly kind: "tool_call";
      readonly payload: { readonly id: string; readonly title: string; readonly status: string };
    }
  | {
      readonly kind: "tool_call_update";
      readonly payload: { readonly id: string; readonly status: string };
    }
  | {
      readonly kind: "permission_requested";
      readonly payload: {
        readonly title: string;
        readonly options: ReadonlyArray<{ readonly optionId: string; readonly name: string }>;
      };
    }
  | { readonly kind: "permission_resolved"; readonly payload: { readonly optionId: string | null } }
  | { readonly kind: "turn_finished"; readonly payload: { readonly stopReason: string } }
  | { readonly kind: "plan"; readonly payload: { readonly entries: unknown } }
  | { readonly kind: "status"; readonly payload: { readonly update: string } };

export type { HarnessEvent };

export interface HarnessSession {
  readonly id: string;
  readonly prompt: (text: string) => Promise<acp.PromptResponse>;
  readonly history: () => ReadonlyArray<StoredEvent>;
  readonly respondPermission: (optionId: string | null) => void;
  readonly subscribe: (listener: (event: HarnessEvent) => void) => () => void;
}

interface AdapterCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

interface PendingPermission {
  readonly sessionId: string;
  readonly resolve: (response: acp.RequestPermissionResponse) => void;
}

const adapterPackages = {
  claude: "@agentclientprotocol/claude-agent-acp",
  codex: "@agentclientprotocol/codex-acp",
} satisfies Record<Exclude<Provider, "fake">, string>;

function adapterCommand(provider: Provider): AdapterCommand {
  if (provider === "fake") {
    return {
      command: process.execPath,
      args: [fileURLToPath(new URL("fake-agent.ts", import.meta.url))],
    };
  }

  const packageName = adapterPackages[provider];
  const packagePath = findPackageJSON(packageName, import.meta.url);
  if (packagePath === undefined) throw new Error(`${packageName} is not installed`);

  return {
    command: process.execPath,
    args: [resolve(dirname(realpathSync(packagePath)), "dist/index.js")],
  };
}

export class TerminalHarness {
  readonly #provider: Provider;
  readonly #cwd: string;
  readonly #store: EventStore;
  readonly #adapter: AdapterCommand;
  readonly #listeners = new Set<(event: HarnessEvent) => void>();
  #permission: PendingPermission | null = null;

  constructor(input: {
    readonly provider: Provider;
    readonly cwd: string;
    readonly store: EventStore;
    readonly adapter?: AdapterCommand;
  }) {
    this.#provider = input.provider;
    this.#cwd = resolve(input.cwd);
    this.#store = input.store;
    this.#adapter = input.adapter ?? adapterCommand(input.provider);
  }

  async run<A>(useSession: (session: HarnessSession) => Promise<A>): Promise<A> {
    const child = spawn(this.#adapter.command, [...this.#adapter.args], {
      cwd: this.#cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();

    const app = acp
      .client({ name: "terminal-meta-harness" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        if (this.#permission !== null) {
          return { outcome: { outcome: "cancelled" } };
        }
        return new Promise<acp.RequestPermissionResponse>((complete) => {
          this.#permission = { sessionId: params.sessionId, resolve: complete };
          this.#record(params.sessionId, {
            kind: "permission_requested",
            payload: {
              title: params.toolCall.title ?? "Agent action",
              options: params.options.map(({ optionId, name }) => ({ optionId, name })),
            },
          });
        });
      });

    try {
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      return await app.connectWith(stream, async (agent) => {
        const initialized = await agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "terminal-meta-harness", version: "0.1.0" },
        });
        if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw new Error(`Unsupported ACP protocol ${initialized.protocolVersion}`);
        }

        return agent.buildSession(this.#cwd).withSession(async (session) => {
          this.#store.startSession(session.sessionId, this.#provider);
          return useSession({
            id: session.sessionId,
            prompt: (text) => this.#runTurn(session, text),
            history: () => this.#store.events(session.sessionId),
            respondPermission: (optionId) => this.#respondPermission(optionId),
            subscribe: (listener) => this.#subscribe(listener),
          });
        });
      });
    } finally {
      this.#respondPermission(null);
      await stopChild(child);
    }
  }

  async #runTurn(session: acp.ActiveSession, text: string): Promise<acp.PromptResponse> {
    this.#record(session.sessionId, { kind: "user_message", payload: { text } });
    const prompt = session.prompt(text);

    try {
      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === "stop") {
          this.#record(session.sessionId, {
            kind: "turn_finished",
            payload: { stopReason: message.stopReason },
          });
          return await prompt;
        }
        this.#record(session.sessionId, normalizeUpdate(message.update));
      }
    } catch (error) {
      await prompt.catch(() => undefined);
      throw error;
    }
  }

  #respondPermission(optionId: string | null): void {
    const permission = this.#permission;
    if (permission === null) return;
    this.#permission = null;
    this.#record(permission.sessionId, {
      kind: "permission_resolved",
      payload: { optionId },
    });
    permission.resolve(
      optionId === null
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "selected", optionId } },
    );
  }

  #subscribe(listener: (event: HarnessEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #record(sessionId: string, event: HarnessEvent): void {
    this.#store.append(sessionId, event);
    for (const listener of this.#listeners) listener(event);
  }
}

function normalizeUpdate(update: acp.SessionUpdate): HarnessEvent {
  if (
    (update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk") &&
    update.content.type === "text"
  ) {
    return {
      kind: update.sessionUpdate === "agent_message_chunk" ? "agent_message" : "agent_thought",
      payload: { text: update.content.text },
    };
  }
  if (update.sessionUpdate === "tool_call") {
    return {
      kind: "tool_call",
      payload: { id: update.toolCallId, title: update.title, status: update.status ?? "pending" },
    };
  }
  if (update.sessionUpdate === "tool_call_update") {
    return {
      kind: "tool_call_update",
      payload: { id: update.toolCallId, status: update.status ?? "pending" },
    };
  }
  if (update.sessionUpdate === "plan") {
    return { kind: "plan", payload: { entries: update.entries } };
  }
  return { kind: "status", payload: { update: update.sessionUpdate } };
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((complete) => child.once("exit", () => complete()));
}

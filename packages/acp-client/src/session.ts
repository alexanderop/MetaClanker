import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import * as acp from "@agentclientprotocol/sdk";
import { Effect } from "effect";

import type {
  AcpRuntimeError,
  AcpSessionHandle,
  AcpSessions,
  NormalizedAgentEvent,
  OpenAcpSessionInput,
  SessionCapabilities,
} from "@metaclanker/application/ports";
import { AgentNodeId, PendingInteractionId } from "@metaclanker/contracts/ids";
import type { TurnId } from "@metaclanker/contracts/ids";
import type { PermissionOption, Provider } from "@metaclanker/contracts/wire";

import { decodeSubagentMetadata, normalizeSessionUpdate } from "./normalize.js";

export const compatibility = {
  protocolVersion: 1,
  sdkVersion: "1.3.0",
  adapters: {
    codex: "1.1.7",
    claude: "0.64.0",
  },
} as const;

export interface AdapterCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly environment?: Readonly<Record<string, string>>;
}

export const adapterEntry = (provider: Provider): string => {
  const specifier =
    provider === "codex"
      ? "@agentclientprotocol/codex-acp"
      : "@agentclientprotocol/claude-agent-acp";
  const clientPackage = realpathSync(
    resolvePath(process.cwd(), "node_modules/@metaclanker/acp-client/package.json"),
  );
  const adapterPackage = findPackageJSON(specifier, pathToFileURL(clientPackage).href);
  if (adapterPackage === undefined) {
    throw new Error(`The ${provider} ACP adapter is not installed`);
  }
  return resolvePath(dirname(adapterPackage), "dist/index.js");
};

export const realAdapterCommands = (): Readonly<Record<Provider, AdapterCommand>> => ({
  codex: { command: process.execPath, args: [adapterEntry("codex")] },
  claude: { command: process.execPath, args: [adapterEntry("claude")] },
});

class RuntimeFailure extends Error implements AcpRuntimeError {
  readonly _tag = "AcpRuntimeError";
  readonly code: AcpRuntimeError["code"];

  constructor(code: AcpRuntimeError["code"], message: string) {
    super(message);
    this.name = "AcpRuntimeError";
    this.code = code;
  }
}

const runtimeFailure = (code: AcpRuntimeError["code"], cause: unknown): RuntimeFailure =>
  new RuntimeFailure(code, cause instanceof Error ? cause.message : String(cause));

const permissionKind = (kind: acp.PermissionOptionKind): PermissionOption["kind"] => {
  if (kind === "allow_once") return "allow-once";
  if (kind === "allow_always") return "allow-always";
  if (kind === "reject_once") return "reject-once";
  return "reject-always";
};

const mapCapabilities = (response: acp.InitializeResponse): SessionCapabilities => {
  const agent = response.agentCapabilities;
  const sessions = agent?.sessionCapabilities;
  return {
    protocolVersion: 1,
    resume: sessions?.resume != null,
    load: agent?.loadSession === true,
    close: sessions?.close != null,
    delete: sessions?.delete != null,
    graph: "available",
    models: [],
    modes: [],
  };
};

const outcome = (reason: acp.StopReason) => {
  if (reason === "cancelled") return "cancelled" as const;
  return "completed" as const;
};

const subagentState = (status: acp.ToolCallStatus | null | undefined) => {
  if (status === "failed") return "failed" as const;
  if (status === "completed") return "completed" as const;
  return "running" as const;
};

const noopEmitter = (): Promise<void> => Promise.resolve();

interface PendingPermission {
  readonly resolve: (response: acp.RequestPermissionResponse) => void;
  readonly sessionId: string;
}

const writableToChild = (child: ReturnType<typeof spawn>): WritableStream<Uint8Array> =>
  new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        const stdin = child.stdin;
        if (stdin === null) {
          reject(new Error("ACP adapter stdin is unavailable"));
          return;
        }
        stdin.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    },
    close() {
      child.stdin?.end();
    },
  });

const readableFromChild = (child: ReturnType<typeof spawn>): ReadableStream<Uint8Array> => {
  let finished = false;
  return new ReadableStream({
    start(controller) {
      const stdout = child.stdout;
      if (stdout === null) {
        finished = true;
        controller.error(new Error("ACP adapter stdout is unavailable"));
        return;
      }
      stdout.on("data", (chunk: Buffer) => {
        if (!finished) controller.enqueue(chunk);
      });
      stdout.on("end", () => {
        if (finished) return;
        finished = true;
        controller.close();
      });
      stdout.on("error", (error) => {
        if (finished) return;
        finished = true;
        controller.error(error);
      });
    },
    cancel() {
      finished = true;
    },
  });
};

const openSession = (
  input: OpenAcpSessionInput,
  adapter: AdapterCommand,
): Effect.Effect<AcpSessionHandle, AcpRuntimeError> =>
  Effect.tryPromise({
    try: async () => {
      let permissionMode = input.permissionMode;
      if (permissionMode === "workspace-write") permissionMode = "agent";
      if (permissionMode === "full-access") permissionMode = "agent-full-access";
      const codexConfig = {
        ...(input.model === null ? {} : { model: input.model }),
        ...(input.effort === null ? {} : { model_reasoning_effort: input.effort }),
      };
      const sessionEnvironment =
        input.provider === "codex"
          ? {
              ...(Object.keys(codexConfig).length === 0
                ? {}
                : { CODEX_CONFIG: JSON.stringify(codexConfig) }),
              ...(permissionMode === null ? {} : { INITIAL_AGENT_MODE: permissionMode }),
            }
          : {};
      const child = spawn(adapter.command, [...adapter.args], {
        cwd: input.cwd,
        env: { ...process.env, ...adapter.environment, ...sessionEnvironment },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const diagnostics: string[] = [];
      let diagnosticBytes = 0;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const redacted = chunk
          .replaceAll(input.cwd, "<project>")
          .replace(/(token|secret|password)=\S+/giu, "$1=<redacted>");
        diagnostics.push(redacted);
        diagnosticBytes += Buffer.byteLength(redacted);
        while (diagnosticBytes > 64 * 1024 && diagnostics.length > 1) {
          const removed = diagnostics.shift();
          diagnosticBytes -= Buffer.byteLength(removed ?? "");
        }
      });

      let activeEmitter: (event: NormalizedAgentEvent) => Promise<void> = noopEmitter;
      let activeTurnId: typeof TurnId.Type | null = null;
      let providerSessionId: string | null = input.providerSessionId;
      let ignoreReplay = input.providerSessionId !== null;
      let updateQueue = Promise.resolve();
      const permissions = new Map<string, PendingPermission>();
      const rootNodeId = AgentNodeId.make(`root:${input.threadId}`);
      const claudeNodesByTool = new Map<string, typeof AgentNodeId.Type>();

      const emitUpdate = async (update: acp.SessionUpdate): Promise<void> => {
        if (activeTurnId === null || ignoreReplay) return;
        for (const event of normalizeSessionUpdate(update)) {
          await activeEmitter(event);
        }
        const subagent = decodeSubagentMetadata(input.provider, update._meta);
        if (subagent?.provider === "codex") {
          const nodeId = AgentNodeId.make(`codex:${input.threadId}:${subagent.threadId}`);
          await activeEmitter({
            type: "agent-node",
            node: {
              id: nodeId,
              threadId: input.threadId,
              parentId: rootNodeId,
              name: subagent.path ?? `Codex subagent ${subagent.threadId.slice(0, 8)}`,
              provider: "codex",
              model: null,
              state: subagent.activity === "interrupted" ? "interrupted" : "running",
              activity: subagent.activity,
              childCount: 0,
              pendingApproval: false,
              changedFileCount: 0,
            },
          });
        }
        if (
          subagent?.provider === "claude" &&
          (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")
        ) {
          const nodeId =
            claudeNodesByTool.get(update.toolCallId) ??
            AgentNodeId.make(`claude:${input.threadId}:${update.toolCallId}`);
          claudeNodesByTool.set(update.toolCallId, nodeId);
          const parentId =
            subagent.parentToolUseId === null
              ? rootNodeId
              : (claudeNodesByTool.get(subagent.parentToolUseId) ?? rootNodeId);
          await activeEmitter({
            type: "agent-node",
            node: {
              id: nodeId,
              threadId: input.threadId,
              parentId,
              name: update.title ?? "Claude subagent",
              provider: "claude",
              model: null,
              state: subagentState(update.status),
              activity: update.title ?? "Working",
              childCount: 0,
              pendingApproval: false,
              changedFileCount: 0,
            },
          });
        }
      };

      /**
       * Drains queued session updates until no new work was appended while
       * awaiting. `updateQueue` is reassigned as each update arrives, so a
       * single await can return while a newly queued update is still pending —
       * and ending the turn at that moment silently drops it.
       */
      const drainUpdates = async (): Promise<void> => {
        let awaited: Promise<void>;
        do {
          awaited = updateQueue;
          await awaited;
        } while (awaited !== updateQueue);
      };

      const client = acp
        .client({ name: "MetaClanker" })
        .onNotification(acp.methods.client.session.update, ({ params }) => {
          if (providerSessionId === null || params.sessionId !== providerSessionId) return;
          updateQueue = updateQueue.then(() => emitUpdate(params.update));
          return updateQueue;
        })
        .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
          const id = PendingInteractionId.make(crypto.randomUUID());
          if (activeTurnId === null || params.sessionId !== providerSessionId) {
            return { outcome: { outcome: "cancelled" } };
          }
          const response = new Promise<acp.RequestPermissionResponse>((resolve) => {
            permissions.set(id, { resolve, sessionId: params.sessionId });
          });
          await activeEmitter({
            type: "permission",
            interaction: {
              id,
              projectId: input.projectId,
              threadId: input.threadId,
              turnId: activeTurnId,
              nodeId: rootNodeId,
              kind: "permission",
              title: params.toolCall.title ?? "Permission required",
              description: params.toolCall.rawInput
                ? JSON.stringify(params.toolCall.rawInput, null, 2)
                : "The agent needs permission to continue.",
              options: params.options.map((option) => ({
                optionId: option.optionId,
                label: option.name,
                kind: permissionKind(option.kind),
              })),
              status: "pending",
              createdAt: new Date().toISOString(),
            },
          });
          return response;
        });

      const connection = client.connect(
        acp.ndJsonStream(writableToChild(child), readableFromChild(child)),
      );
      const initialized = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          _meta: input.provider === "claude" ? { "subagent-transcript": true } : {},
        },
        clientInfo: { name: "MetaClanker", version: "0.1.0" },
      });
      if (initialized.protocolVersion !== 1) {
        connection.close(new Error(`Unsupported ACP protocol ${initialized.protocolVersion}`));
        child.kill("SIGTERM");
        throw runtimeFailure(
          "protocol",
          `Adapter negotiated unsupported ACP protocol ${initialized.protocolVersion}`,
        );
      }

      const advertised = mapCapabilities(initialized);
      let setupModes: acp.SessionModeState | null | undefined;
      let setupConfigOptions: ReadonlyArray<acp.SessionConfigOption> | null | undefined;
      if (providerSessionId === null) {
        const created = await connection.agent.request(acp.methods.agent.session.new, {
          cwd: input.cwd,
          mcpServers: [],
        });
        providerSessionId = created.sessionId;
        setupModes = created.modes;
        setupConfigOptions = created.configOptions;
        ignoreReplay = false;
      } else if (advertised.resume) {
        const resumed = await connection.agent.request(acp.methods.agent.session.resume, {
          sessionId: providerSessionId,
          cwd: input.cwd,
          mcpServers: [],
        });
        setupModes = resumed.modes;
        setupConfigOptions = resumed.configOptions;
        ignoreReplay = false;
      } else if (advertised.load) {
        const loaded = await connection.agent.request(acp.methods.agent.session.load, {
          sessionId: providerSessionId,
          cwd: input.cwd,
          mcpServers: [],
        });
        setupModes = loaded.modes;
        setupConfigOptions = loaded.configOptions;
        await drainUpdates();
        ignoreReplay = false;
      } else {
        connection.close();
        child.kill("SIGTERM");
        throw runtimeFailure(
          "unsupported",
          "The provider cannot continue this saved session; start a new thread to proceed",
        );
      }

      if (providerSessionId === null) {
        throw runtimeFailure("protocol", "The provider returned no session identifier");
      }
      const sessionId: string = providerSessionId;
      const requestedConfiguration = [
        { categories: ["model"], value: input.model },
        { categories: ["thought_level"], value: input.effort },
        { categories: ["mode"], value: permissionMode },
      ];
      for (const requested of requestedConfiguration) {
        if (requested.value === null) continue;
        const option = setupConfigOptions?.find(
          (candidate) =>
            candidate.type === "select" &&
            (requested.categories.includes(candidate.category ?? "") ||
              requested.categories.includes(candidate.id)),
        );
        if (option === undefined) continue;
        await connection.agent.request(acp.methods.agent.session.setConfigOption, {
          sessionId,
          configId: option.id,
          value: requested.value,
        });
      }
      if (
        permissionMode !== null &&
        setupModes?.availableModes.some((mode) => mode.id === permissionMode) === true &&
        setupModes.currentModeId !== permissionMode
      ) {
        await connection.agent.request(acp.methods.agent.session.setMode, {
          sessionId,
          modeId: permissionMode,
        });
      }
      const availableConfigValues = (category: string): ReadonlyArray<string> =>
        setupConfigOptions?.flatMap((option) => {
          if (option.type !== "select" || option.category !== category) return [];
          return option.options.flatMap((item) =>
            "value" in item ? [item.value] : item.options.map((value) => value.value),
          );
        }) ?? [];
      const capabilities = {
        ...advertised,
        models: availableConfigValues("model"),
        modes: setupModes?.availableModes.map((mode) => mode.id) ?? [],
      } satisfies SessionCapabilities;
      let promptActive = false;
      let closed = false;

      const expirePermissions = () => {
        for (const permission of permissions.values()) {
          permission.resolve({ outcome: { outcome: "cancelled" } });
        }
        permissions.clear();
      };
      /** Losing the adapter unbinds the turn and cancels anything still pending. */
      const releaseSessionResources = (): void => {
        activeTurnId = null;
        activeEmitter = noopEmitter;
        expirePermissions();
      };
      connection.closed.then(releaseSessionResources, releaseSessionResources);

      return {
        providerSessionId: sessionId,
        capabilities,
        prompt: (promptInput, emit) => {
          if (promptActive) {
            return Effect.fail(
              runtimeFailure("protocol", "Only one ordinary prompt may run per ACP session"),
            );
          }
          promptActive = true;
          activeEmitter = emit;
          activeTurnId = promptInput.turnId;
          return Effect.tryPromise({
            try: async () => {
              const blocks: acp.ContentBlock[] = [
                { type: "text", text: promptInput.text },
                ...promptInput.attachments.map(
                  (uri): acp.ContentBlock => ({ type: "resource_link", uri, name: uri }),
                ),
              ];
              const response = await connection.agent.request<
                acp.PromptResponse,
                acp.PromptRequest
              >(acp.methods.agent.session.prompt, { sessionId, prompt: blocks });
              await drainUpdates();
              return { stopReason: outcome(response.stopReason) };
            },
            catch: (cause) => runtimeFailure("disconnected", cause),
          }).pipe(
            // The turn's emitter stays installed after the response resolves.
            // An adapter may deliver a trailing `session/update` alongside the
            // `session/prompt` response; unbinding here would silently discard
            // it. The next prompt replaces the binding, and close clears it.
            Effect.ensuring(Effect.sync(() => (promptActive = false))),
          );
        },
        requestCancel: () =>
          Effect.tryPromise({
            try: () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }),
            catch: (cause) => runtimeFailure("disconnected", cause),
          }),
        respondInteraction: (id, optionId) =>
          Effect.gen(function* () {
            const pending = permissions.get(id);
            if (pending === undefined || pending.sessionId !== sessionId) {
              return yield* Effect.fail(
                runtimeFailure("disconnected", "Permission is stale or already resolved"),
              );
            }
            permissions.delete(id);
            pending.resolve({ outcome: { outcome: "selected", optionId } });
          }),
        close: Effect.tryPromise({
          try: async () => {
            if (closed) return;
            closed = true;
            activeTurnId = null;
            activeEmitter = noopEmitter;
            expirePermissions();
            if (capabilities.close) {
              await connection.agent.request(acp.methods.agent.session.close, { sessionId });
            }
            connection.close();
            await connection.closed;
            child.kill("SIGTERM");
            const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
            force.unref();
            await new Promise<void>((resolve) => {
              if (child.exitCode !== null) {
                resolve();
                return;
              }
              child.once("exit", () => resolve());
            });
            clearTimeout(force);
          },
          catch: () => undefined,
        }).pipe(Effect.catch(() => Effect.void)),
      } satisfies AcpSessionHandle;
    },
    catch: (cause) => (cause instanceof RuntimeFailure ? cause : runtimeFailure("spawn", cause)),
  });

export const makeAcpSessions = (
  commands: Readonly<Record<Provider, AdapterCommand>> = realAdapterCommands(),
): AcpSessions => ({
  open: (input) => openSession(input, commands[input.provider]),
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { Store } from "@metaclanker/application/commands";
import type { CreateProjectRecord } from "@metaclanker/application/ports";
import type { AdapterCommand } from "@metaclanker/acp-client/session";
import type { ShellSnapshot, ThreadDetail } from "@metaclanker/contracts/wire";
import type {
  StartThreadWithPromptInput,
  StartThreadWithPromptResult,
} from "../utils/orchestrator.js";

export interface OrchestrationHarness {
  readonly projectDirectory: string;
  readonly createProject: (input: CreateProjectRecord) => Promise<void>;
  readonly startThreadWithPrompt: (
    input: StartThreadWithPromptInput,
  ) => Promise<StartThreadWithPromptResult>;
  readonly shellSnapshot: () => Promise<ShellSnapshot>;
  readonly threadDetail: (
    id: StartThreadWithPromptResult["thread"]["id"],
  ) => Promise<ThreadDetail | null>;
  /** Awaits the provider ingestion and persistence worker for accepted turns. */
  readonly drain: () => Promise<void>;
  /** Drains current background work by closing active ACP handles, then joins every worker. */
  readonly close: () => Promise<void>;
}

export interface OrchestrationHarnessOptions {
  /** A deliberately missing entry exercises failure after durable acceptance. */
  readonly fakeAcpEntry?: string;
  /** Serialized fake scenario inherited by the production ACP child process. */
  readonly fakeAcpScenario?: string;
}

const restoreEnvironment = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

/**
 * Server-owned integration support. It starts the production composition root
 * against unique data and project directories; no real user data is reachable.
 */
export const withOrchestrationHarness = async <A>(
  use: (harness: OrchestrationHarness) => Promise<A>,
  options: OrchestrationHarnessOptions = {},
): Promise<A> => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "metaclanker-orchestrator-data-"));
  const projectDirectory = await mkdtemp(join(tmpdir(), "metaclanker-orchestrator-project-"));
  const previousFakeScenario = process.env["METACLANKER_FAKE_ACP_SCENARIO"];
  const fakeEntry =
    options.fakeAcpEntry ?? join(process.cwd(), "packages/testing/dist/acp/fake-agent.js");
  const fakeCommand: AdapterCommand = { command: process.execPath, args: [fakeEntry] };
  process.env["METACLANKER_FAKE_ACP_SCENARIO"] =
    options.fakeAcpScenario ??
    JSON.stringify({
      prompt: { mode: "complete", message: "Integration fake completed" },
    });

  try {
    const loadedRuntime = await import("../utils/runtime.js");
    const loadedOrchestrator = await import("../utils/orchestrator.js");
    const runStore = <B>(effect: Effect.Effect<B, unknown, Store>): Promise<B> =>
      loadedRuntime.runApplication(effect);
    const harness: OrchestrationHarness = {
      projectDirectory,
      createProject: async (input) => {
        await runStore(
          Effect.gen(function* () {
            const store = yield* Store;
            yield* store.createProject(input);
          }),
        );
      },
      startThreadWithPrompt: loadedOrchestrator.startThreadWithPrompt,
      shellSnapshot: () =>
        runStore(
          Effect.gen(function* () {
            const store = yield* Store;
            return yield* store.shellSnapshot;
          }),
        ),
      threadDetail: (id) =>
        runStore(
          Effect.gen(function* () {
            const store = yield* Store;
            return yield* store.getThread(id);
          }),
        ),
      drain: loadedOrchestrator.drainAgentWork,
      close: loadedOrchestrator.closeAgentSessions,
    };
    const runtime = loadedRuntime.makeApplicationRuntime(dataDirectory, {
      commands: { codex: fakeCommand, claude: fakeCommand },
      readiness: { codex: true, claude: true },
    });
    return await loadedRuntime.withApplicationRuntimeForTest(runtime, async () => {
      try {
        return await use(harness);
      } finally {
        await loadedOrchestrator.closeAgentSessions();
        await runtime.dispose();
      }
    });
  } finally {
    restoreEnvironment("METACLANKER_FAKE_ACP_SCENARIO", previousFakeScenario);
    await Promise.all([
      rm(dataDirectory, { recursive: true, force: true }),
      rm(projectDirectory, { recursive: true, force: true }),
    ]);
  }
};

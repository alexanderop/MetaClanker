import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";

import { Store } from "@metaclanker/application/commands";
import type { CreateProjectRecord } from "@metaclanker/application/ports";
import type { AdapterCommand } from "@metaclanker/acp-client/session";
import type { ShellSnapshot, ThreadDetail } from "@metaclanker/contracts/wire";
import type {
  StartThreadWithPromptInput,
  StartThreadWithPromptResult,
} from "../utils/orchestrator.js";
import type { ApplicationRuntime } from "../utils/runtime.js";

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
  /** Recreates the full application runtime against the same durable data directory. */
  readonly restartRuntime: () => Promise<void>;
  readonly setFakeAcpScenario: (scenario: string) => void;
}

export interface OrchestrationHarnessOptions {
  /** A deliberately missing entry exercises failure after durable acceptance. */
  readonly fakeAcpEntry?: string;
  /** Serialized fake scenario inherited by the production ACP child process. */
  readonly fakeAcpScenario?: string;
}

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
  const fakeEntry =
    options.fakeAcpEntry ?? join(process.cwd(), "packages/testing/dist/acp/fake-agent.js");
  let fakeScenario =
    options.fakeAcpScenario ??
    JSON.stringify({
      prompt: { mode: "complete", message: "Integration fake completed" },
    });
  const fakeCommand: AdapterCommand = {
    command: process.execPath,
    args: [fakeEntry],
    environment: () => ({ METACLANKER_FAKE_ACP_SCENARIO: fakeScenario }),
  };

  try {
    const loadedRuntime = await import("../utils/runtime.js");
    const loadedOrchestrator = await import("../utils/orchestrator.js");
    const providerAdapters = {
      commands: { codex: fakeCommand, claude: fakeCommand },
      readiness: { codex: true, claude: true },
    } as const;
    let runtime = loadedRuntime.makeApplicationRuntime(dataDirectory, providerAdapters);
    const scopedRuntime: ApplicationRuntime = {
      dataDirectory,
      providerAdapters,
      runApplication: (effect) => runtime.runApplication(effect),
      dispose: () => runtime.dispose(),
    };
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
      restartRuntime: async () => {
        await loadedOrchestrator.closeAgentSessions();
        await runtime.dispose();
        runtime = loadedRuntime.makeApplicationRuntime(dataDirectory, providerAdapters);
      },
      setFakeAcpScenario: (scenario) => {
        fakeScenario = scenario;
      },
    };
    return await loadedRuntime.withApplicationRuntimeForTest(scopedRuntime, async () => {
      try {
        return await use(harness);
      } finally {
        await loadedOrchestrator.closeAgentSessions();
        await runtime.dispose();
      }
    });
  } finally {
    await Promise.all([
      rm(dataDirectory, { recursive: true, force: true }),
      rm(projectDirectory, { recursive: true, force: true }),
    ]);
  }
};

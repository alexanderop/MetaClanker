import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";

import { adapterEntry, type AdapterCommand } from "@metaclanker/acp-client/session";
import type { Provider } from "@metaclanker/contracts/wire";
import { AgentCommands } from "@metaclanker/application/agent-commands";
import type { AgentCommandsService } from "@metaclanker/application/agent-commands";
import type { CheckpointService, Files, Store } from "@metaclanker/application/commands";
import { CheckpointService as ApplicationCheckpointService } from "@metaclanker/application/commands";
import {
  CheckpointsService,
  checkpointsLayer,
  projectFilesLayer,
} from "@metaclanker/git/checkpoints";
import { databaseLayer } from "@metaclanker/persistence/database";

import type { AgentWork } from "./agent-work.js";
import { agentWorkLayer } from "./agent-work.js";
import type { LocalDiagnostics } from "./local-diagnostics.js";
import { localDiagnosticsLayer } from "./local-diagnostics.js";
import { agentCommandsLayer } from "../services/agent-commands.js";

type ApplicationRequirements =
  | Store
  | AgentCommands
  | Files
  | CheckpointsService
  | CheckpointService
  | AgentWork
  | LocalDiagnostics;

export interface ProviderAdapters {
  readonly commands: Readonly<Record<Provider, AdapterCommand>>;
  readonly readiness: Readonly<Record<Provider, boolean>>;
}

const unavailableAdapter = (): AdapterCommand => ({
  command: process.execPath,
  args: ["--eval", "process.exit(1)"],
});

const productionProviderAdapters = (): ProviderAdapters => {
  const resolveAdapter = (
    provider: Provider,
  ): { readonly command: AdapterCommand; readonly ready: boolean } => {
    try {
      return {
        command: { command: process.execPath, args: [adapterEntry(provider)] },
        ready: true,
      };
    } catch {
      return { command: unavailableAdapter(), ready: false };
    }
  };
  const codex = resolveAdapter("codex");
  const claude = resolveAdapter("claude");
  return {
    commands: { codex: codex.command, claude: claude.command },
    readiness: { codex: codex.ready, claude: claude.ready },
  };
};

/** The packaged server never accepts an arbitrary adapter override. This narrowly supports built E2E. */
const testProviderAdapters = (): ProviderAdapters | undefined => {
  const fakeEntry = process.env["METACLANKER_TEST_ACP_ENTRY"];
  if (process.env["NODE_ENV"] !== "test" || fakeEntry === undefined || !existsSync(fakeEntry)) {
    return undefined;
  }
  const command: AdapterCommand = { command: process.execPath, args: [fakeEntry] };
  return {
    commands: { codex: command, claude: command },
    readiness: { codex: true, claude: true },
  };
};

export interface ApplicationRuntime {
  readonly dataDirectory: string;
  readonly providerAdapters: ProviderAdapters;
  readonly runApplication: <A, E>(
    effect: Effect.Effect<A, E, ApplicationRequirements>,
  ) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

const testRuntimeScope = new AsyncLocalStorage<ApplicationRuntime>();

const run = async <A, E>(
  runtime: ManagedRuntime.ManagedRuntime<ApplicationRequirements, unknown>,
  effect: Effect.Effect<A, E, ApplicationRequirements>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw Cause.squash(exit.cause);
};

export const makeApplicationRuntime = (
  dataDirectory: string,
  providerAdapters: ProviderAdapters = testProviderAdapters() ?? productionProviderAdapters(),
): ApplicationRuntime => {
  const resolvedDataDirectory = resolve(dataDirectory);
  mkdirSync(join(resolvedDataDirectory, "checkpoints"), { recursive: true });
  const checkpoints = checkpointsLayer(join(resolvedDataDirectory, "checkpoints"));
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      databaseLayer(join(resolvedDataDirectory, "metaclanker.sqlite")),
      projectFilesLayer,
      checkpoints,
      Layer.effect(
        ApplicationCheckpointService,
        Effect.gen(function* () {
          return yield* CheckpointsService;
        }),
      ).pipe(Layer.provide(checkpoints)),
      agentWorkLayer,
      localDiagnosticsLayer(resolvedDataDirectory),
      agentCommandsLayer,
    ),
  );
  return {
    dataDirectory: resolvedDataDirectory,
    providerAdapters,
    runApplication: async <A, E>(effect: Effect.Effect<A, E, ApplicationRequirements>) =>
      await run(runtime, effect),
    dispose: () => runtime.dispose(),
  };
};

const currentApplicationRuntime = async (): Promise<ApplicationRuntime> => {
  const testRuntime = testRuntimeScope.getStore();
  if (testRuntime !== undefined) return testRuntime;
  const production = await import("./runtime-app.js");
  return production.currentApplicationRuntime();
};

export const runApplication = async <A, E>(
  effect: Effect.Effect<A, E, ApplicationRequirements>,
): Promise<A> => await (await currentApplicationRuntime()).runApplication(effect);

export const runAgentCommand = async <A>(
  use: (commands: AgentCommandsService) => Promise<A>,
): Promise<A> =>
  await runApplication(
    Effect.gen(function* () {
      const commands = yield* AgentCommands;
      return yield* Effect.tryPromise({ try: () => use(commands), catch: (cause) => cause });
    }),
  );

export const applicationDataDirectory = async (): Promise<string> =>
  (await currentApplicationRuntime()).dataDirectory;

export const applicationProviderAdapters = async (): Promise<ProviderAdapters> =>
  (await currentApplicationRuntime()).providerAdapters;

/** Server-owned test support scopes a factory runtime to one isolated harness. */
export const withApplicationRuntimeForTest = async <A>(
  runtime: ApplicationRuntime,
  use: () => Promise<A>,
): Promise<A> => await testRuntimeScope.run(runtime, use);

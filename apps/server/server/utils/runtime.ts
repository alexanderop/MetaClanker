import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";

import { adapterEntry, type AdapterCommand } from "@metaclanker/acp-client/session";
import type { Provider } from "@metaclanker/contracts/wire";
import { AgentCommands } from "@metaclanker/application/agent-commands";
import type { AgentCommandsService } from "@metaclanker/application/agent-commands";
import type { ApplicationError } from "@metaclanker/application/commands";
import type { CheckpointService, Files, Store } from "@metaclanker/application/commands";
import type { StoreError } from "@metaclanker/application/ports";
import { CheckpointService as ApplicationCheckpointService } from "@metaclanker/application/commands";
import {
  CheckpointsService,
  checkpointsLayer,
  projectFilesLayer,
} from "@metaclanker/git/checkpoints";
import { databaseLayer } from "@metaclanker/persistence/database";

import type { LocalDiagnostics } from "./local-diagnostics.js";
import { localDiagnosticsLayer } from "./local-diagnostics.js";
import type { TurnSupervisor } from "./turn-supervisor.js";
import { turnSupervisorLayer } from "./turn-supervisor.js";
import type { EventFanout } from "./event-fanout.js";
import { eventFanoutLayer } from "./event-fanout.js";
import { agentCommandsLayer } from "../services/agent-commands.js";
import type { Authentication } from "./auth.js";
import { authenticationLayer } from "./auth.js";

type ApplicationRequirements =
  | Store
  | AgentCommands
  | Files
  | CheckpointsService
  | CheckpointService
  | LocalDiagnostics
  | TurnSupervisor
  | EventFanout
  | Authentication;

/** Everything the composition root's layers can fail with while being built. */
type ApplicationLayerError = StoreError | Config.ConfigError;

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
    return Effect.runSync(
      Effect.try({
        try: () => ({ command: process.execPath, args: [adapterEntry(provider)] }),
        catch: () => undefined,
      }).pipe(
        Effect.map((command) => ({ command, ready: true }) as const),
        Effect.catch(() => Effect.succeed({ command: unavailableAdapter(), ready: false })),
      ),
    );
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
  const configuration = Effect.runSync(
    Config.all({
      nodeEnvironment: Config.string("NODE_ENV").pipe(Config.withDefault("production")),
      fakeEntry: Config.option(Config.string("METACLANKER_TEST_ACP_ENTRY")),
    }),
  );
  const fakeEntry = Option.getOrUndefined(configuration.fakeEntry);
  if (
    configuration.nodeEnvironment !== "test" ||
    fakeEntry === undefined ||
    !existsSync(fakeEntry)
  ) {
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
  runtime: ManagedRuntime.ManagedRuntime<ApplicationRequirements, ApplicationLayerError>,
  effect: Effect.Effect<A, E, ApplicationRequirements>,
): Promise<A> => {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.findErrorOption(exit.cause);
  // Typed application failures are `Error` subclasses and reach `publicError` intact.
  // A layer-build failure such as `ConfigError` is not, and has no public mapping.
  if (Option.isSome(failure)) {
    throw failure.value instanceof Error ? failure.value : new Error(String(failure.value));
  }
  throw Cause.squash(exit.cause);
};

export const makeApplicationRuntime = (
  dataDirectory: string,
  providerAdapters: ProviderAdapters = testProviderAdapters() ?? productionProviderAdapters(),
): ApplicationRuntime => {
  const resolvedDataDirectory = resolve(dataDirectory);
  mkdirSync(join(resolvedDataDirectory, "checkpoints"), { recursive: true });
  const checkpoints = checkpointsLayer(join(resolvedDataDirectory, "checkpoints"));
  const coreLayer = Layer.mergeAll(
    databaseLayer(join(resolvedDataDirectory, "metaclanker.sqlite")),
    projectFilesLayer,
    checkpoints,
    Layer.effect(
      ApplicationCheckpointService,
      Effect.gen(function* () {
        return yield* CheckpointsService;
      }),
    ).pipe(Layer.provide(checkpoints)),
    localDiagnosticsLayer(resolvedDataDirectory),
    turnSupervisorLayer,
    eventFanoutLayer,
    authenticationLayer(),
  );
  const runtime = ManagedRuntime.make(
    Layer.merge(coreLayer, agentCommandsLayer(providerAdapters).pipe(Layer.provide(coreLayer))),
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
  use: (commands: AgentCommandsService) => Effect.Effect<A, ApplicationError>,
): Promise<A> =>
  await runApplication(
    Effect.gen(function* () {
      const commands = yield* AgentCommands;
      return yield* use(commands);
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

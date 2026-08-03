import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AgentCommands } from "@metaclanker/application/agent-commands";
import { Store } from "@metaclanker/application/commands";
import type { AdapterCommand } from "@metaclanker/acp-client/session";
import type { Provider } from "@metaclanker/contracts/wire";
import { CheckpointsService } from "@metaclanker/git/checkpoints";

import {
  cancelPromptEffect,
  dispatchPromptEffect,
  listProviderReadinessEffect,
  respondToInteractionEffect,
  restoreThreadFilesEffect,
  startThreadWithPromptEffect,
} from "../utils/orchestrator.js";
import { EventFanout } from "../utils/event-fanout.js";
import { LocalDiagnostics } from "../utils/local-diagnostics.js";
import { TurnSupervisor } from "../utils/turn-supervisor.js";

export interface AgentCommandAdapters {
  readonly commands: Readonly<Record<Provider, AdapterCommand>>;
  readonly readiness: Readonly<Record<Provider, boolean>>;
}

/** Server adapter for the application-level agent command port. */
export const agentCommandsLayer = (adapters: AgentCommandAdapters) =>
  Layer.effect(
    AgentCommands,
    Effect.gen(function* () {
      const store = yield* Store;
      const checkpoints = yield* CheckpointsService;
      const fanout = yield* EventFanout;
      const supervisor = yield* TurnSupervisor;
      const diagnostics = yield* LocalDiagnostics;
      const provideCore = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(Store, store),
          Effect.provideService(CheckpointsService, checkpoints),
          Effect.provideService(EventFanout, fanout),
          Effect.provideService(TurnSupervisor, supervisor),
          Effect.provideService(LocalDiagnostics, diagnostics),
        );
      return {
        providerReadiness: () =>
          listProviderReadinessEffect(adapters.readiness).pipe(Effect.provideService(Store, store)),
        startThread: (input) =>
          provideCore(startThreadWithPromptEffect(adapters.commands, adapters.readiness, input)),
        dispatchPrompt: (commandId, threadId, text, attachments) =>
          provideCore(
            dispatchPromptEffect(
              adapters.commands,
              adapters.readiness,
              commandId,
              threadId,
              text,
              attachments,
            ),
          ),
        cancelPrompt: (commandId, threadId) =>
          cancelPromptEffect(commandId, threadId).pipe(
            Effect.provideService(Store, store),
            Effect.provideService(EventFanout, fanout),
            Effect.provideService(TurnSupervisor, supervisor),
          ),
        respondToInteraction: (commandId, interactionId, optionId) =>
          respondToInteractionEffect(commandId, interactionId, optionId).pipe(
            Effect.provideService(Store, store),
            Effect.provideService(EventFanout, fanout),
            Effect.provideService(TurnSupervisor, supervisor),
          ),
        restoreThreadFiles: (commandId, threadId, checkpointId) =>
          restoreThreadFilesEffect(commandId, threadId, checkpointId).pipe(
            Effect.provideService(Store, store),
            Effect.provideService(CheckpointsService, checkpoints),
            Effect.provideService(EventFanout, fanout),
            Effect.provideService(TurnSupervisor, supervisor),
          ),
      };
    }),
  );

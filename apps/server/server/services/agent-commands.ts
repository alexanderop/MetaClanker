import { Effect, Layer } from "effect";

import { AgentCommands } from "@metaclanker/application/agent-commands";
import { ApplicationError } from "@metaclanker/application/commands";

import {
  cancelPrompt,
  dispatchPrompt,
  listProviderReadiness,
  respondToInteraction,
  restoreThreadFiles,
  startThreadWithPrompt,
} from "../utils/orchestrator.js";

const commandFailure = (cause: unknown): ApplicationError =>
  cause instanceof ApplicationError
    ? cause
    : new ApplicationError({ code: "persistence", message: "Agent command failed" });

const fromOrchestrator = <A>(operation: () => Promise<A>): Effect.Effect<A, ApplicationError> =>
  Effect.tryPromise({ try: operation, catch: commandFailure });

/** Server adapter for the application-level agent command port. */
export const agentCommandsLayer = Layer.effect(
  AgentCommands,
  Effect.sync(() => ({
    providerReadiness: () => fromOrchestrator(listProviderReadiness),
    startThread: (input) => fromOrchestrator(() => startThreadWithPrompt(input)),
    dispatchPrompt: (commandId, threadId, text, attachments) =>
      fromOrchestrator(() => dispatchPrompt(commandId, threadId, text, attachments)),
    cancelPrompt: (commandId, threadId) =>
      fromOrchestrator(() => cancelPrompt(commandId, threadId)),
    respondToInteraction: (commandId, interactionId, optionId) =>
      fromOrchestrator(() => respondToInteraction(commandId, interactionId, optionId)),
    restoreThreadFiles: (commandId, threadId, checkpointId) =>
      fromOrchestrator(() => restoreThreadFiles(commandId, threadId, checkpointId)),
  })),
);

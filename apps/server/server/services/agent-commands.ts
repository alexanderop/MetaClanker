import { Effect, Layer } from "effect";

import { AgentCommands } from "@metaclanker/application/agent-commands";

import {
  cancelPrompt,
  dispatchPrompt,
  listProviderReadiness,
  respondToInteraction,
  restoreThreadFiles,
  startThreadWithPrompt,
} from "../utils/orchestrator.js";

/** Server adapter for the application-level agent command port. */
export const agentCommandsLayer = Layer.effect(
  AgentCommands,
  Effect.sync(() => ({
    providerReadiness: () => listProviderReadiness(),
    startThread: (input) => startThreadWithPrompt(input),
    dispatchPrompt: (commandId, threadId, text, attachments) =>
      dispatchPrompt(commandId, threadId, text, attachments),
    cancelPrompt: (threadId) => cancelPrompt(threadId),
    respondToInteraction: (commandId, interactionId, optionId) =>
      respondToInteraction(commandId, interactionId, optionId),
    restoreThreadFiles: (threadId, checkpointId) => restoreThreadFiles(threadId, checkpointId),
  })),
);

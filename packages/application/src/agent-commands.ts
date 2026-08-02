import { Context, type Effect } from "effect";

import type { ApplicationError } from "./commands.js";

import type {
  CommandId,
  PendingInteractionId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@metaclanker/contracts/ids";
import type { PendingInteraction, Provider, Thread } from "@metaclanker/contracts/wire";

export interface StartAgentThreadInput {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly provider: Provider;
  readonly model: string | null;
  readonly effort: string | null;
  readonly permissionMode: string | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<string>;
}

export interface AgentCommandsService {
  readonly providerReadiness: () => Effect.Effect<
    ReadonlyArray<{
      readonly provider: Provider;
      readonly status: "ready" | "unavailable";
      readonly reason: string | null;
    }>,
    ApplicationError
  >;
  readonly startThread: (
    input: StartAgentThreadInput,
  ) => Effect.Effect<
    { readonly accepted: true; readonly thread: Thread; readonly turnId: TurnId },
    ApplicationError
  >;
  readonly dispatchPrompt: (
    commandId: CommandId,
    threadId: ThreadId,
    text: string,
    attachments: ReadonlyArray<string>,
  ) => Effect.Effect<TurnId, ApplicationError>;
  readonly cancelPrompt: (
    commandId: CommandId,
    threadId: ThreadId,
  ) => Effect.Effect<void, ApplicationError>;
  readonly respondToInteraction: (
    commandId: CommandId,
    interactionId: PendingInteractionId,
    optionId: string,
  ) => Effect.Effect<PendingInteraction, ApplicationError>;
  readonly restoreThreadFiles: (
    commandId: CommandId,
    threadId: ThreadId,
    checkpointId: string,
  ) => Effect.Effect<unknown, ApplicationError>;
}

export class AgentCommands extends Context.Service<AgentCommands, AgentCommandsService>()(
  "@metaclanker/application/AgentCommands",
) {}

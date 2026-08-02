import { Context } from "effect";

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
  readonly providerReadiness: () => Promise<
    ReadonlyArray<{
      readonly provider: Provider;
      readonly status: "ready" | "unavailable";
      readonly reason: string | null;
    }>
  >;
  readonly startThread: (input: StartAgentThreadInput) => Promise<{
    readonly accepted: true;
    readonly thread: Thread;
    readonly turnId: TurnId;
  }>;
  readonly dispatchPrompt: (
    commandId: CommandId,
    threadId: ThreadId,
    text: string,
    attachments: ReadonlyArray<string>,
  ) => Promise<TurnId>;
  readonly cancelPrompt: (threadId: ThreadId) => Promise<void>;
  readonly respondToInteraction: (
    commandId: CommandId,
    interactionId: PendingInteractionId,
    optionId: string,
  ) => Promise<PendingInteraction>;
  readonly restoreThreadFiles: (threadId: ThreadId, checkpointId: string) => Promise<unknown>;
}

export class AgentCommands extends Context.Tag("@metaclanker/application/AgentCommands")<
  AgentCommands,
  AgentCommandsService
>() {}

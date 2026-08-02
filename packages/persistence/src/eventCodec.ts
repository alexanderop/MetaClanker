import { Schema } from "effect";

import { MessageId, ProjectId, ThreadId, ToolCallId, TurnId } from "@metaclanker/contracts/ids";
import {
  AgentNode,
  PendingInteraction,
  PersistedCheckpointWire,
  Project,
  Thread,
  ThreadStatus,
  ToolCall,
  UserSettings,
} from "@metaclanker/contracts/wire";
import type { UnsequencedDomainEvent } from "@metaclanker/domain/events";

const Origin = Schema.Literals(["client", "server", "provider", "git"]);
const EventBase = { origin: Origin } as const;

const MessageWithoutSequence = Schema.Struct({
  id: MessageId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  role: Schema.Literals(["user", "agent", "thought", "system"]),
  content: Schema.String,
  createdAt: Schema.String,
});

const ToolCallWithoutSequence = Schema.Struct({
  id: ToolCallId,
  threadId: ThreadId,
  turnId: TurnId,
  nodeId: ToolCall.fields.nodeId,
  title: Schema.String,
  kind: Schema.String,
  status: ToolCall.fields.status,
  content: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const InteractionWithoutSequence = Schema.Struct({
  id: PendingInteraction.fields.id,
  projectId: ProjectId,
  threadId: ThreadId,
  turnId: TurnId,
  nodeId: PendingInteraction.fields.nodeId,
  kind: PendingInteraction.fields.kind,
  title: Schema.String,
  description: Schema.String,
  options: PendingInteraction.fields.options,
  status: PendingInteraction.fields.status,
  createdAt: Schema.String,
});

const EventData = Schema.Union([
  Schema.Struct({ ...EventBase, type: Schema.Literal("project.upserted"), project: Project }),
  Schema.Struct({ ...EventBase, type: Schema.Literal("project.removed"), projectId: ProjectId }),
  Schema.Struct({ ...EventBase, type: Schema.Literal("thread.upserted"), thread: Thread }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("thread.status-changed"),
    threadId: ThreadId,
    status: ThreadStatus,
    updatedAt: Schema.String,
  }),
  Schema.Struct({ ...EventBase, type: Schema.Literal("thread.removed"), threadId: ThreadId }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("turn.started"),
    threadId: ThreadId,
    turnId: TurnId,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("turn.completed"),
    threadId: ThreadId,
    turnId: TurnId,
    outcome: Schema.Literals([
      "completed",
      "cancelled",
      "interrupted",
      "failed",
      "recovery-required",
    ]),
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("message.upserted"),
    message: MessageWithoutSequence,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("tool.upserted"),
    toolCall: ToolCallWithoutSequence,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("interaction.upserted"),
    interaction: InteractionWithoutSequence,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("agent-node.upserted"),
    node: AgentNode,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("checkpoint.saved"),
    record: PersistedCheckpointWire,
  }),
  Schema.Struct({ ...EventBase, type: Schema.Literal("settings.saved"), settings: UserSettings }),
]);

export const UnsequencedDomainEventSchema = EventData;

export const eventThreadId = (event: UnsequencedDomainEvent): ThreadId | null => {
  if (event.type === "project.upserted" || event.type === "project.removed") return null;
  if (event.type === "settings.saved") return null;
  if (event.type === "thread.upserted") return event.thread.id;
  if (event.type === "message.upserted") return event.message.threadId;
  if (event.type === "tool.upserted") return event.toolCall.threadId;
  if (event.type === "interaction.upserted") return event.interaction.threadId;
  if (event.type === "agent-node.upserted") return event.node.threadId;
  if (event.type === "checkpoint.saved") return event.record.threadId;
  return event.threadId;
};

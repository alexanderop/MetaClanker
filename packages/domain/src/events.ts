import type {
  AgentNodeId,
  EventId,
  PendingInteractionId,
  ProjectId,
  Sequence,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";
import type { AgentState, MessageRole, Provider, ThreadStatus } from "@metaclanker/contracts/wire";

interface EventMetadata {
  readonly schemaVersion: 1;
  readonly sequence: Sequence;
  readonly eventId: EventId;
  readonly receivedAt: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly origin: "client" | "server" | "provider" | "git";
}

export type DomainEvent =
  | (EventMetadata & {
      readonly type: "thread.status-changed";
      readonly status: ThreadStatus;
    })
  | (EventMetadata & {
      readonly type: "turn.started";
      readonly turnId: TurnId;
    })
  | (EventMetadata & {
      readonly type: "turn.completed";
      readonly turnId: TurnId;
      readonly outcome: "completed" | "cancelled" | "interrupted" | "failed";
    })
  | (EventMetadata & {
      readonly type: "message.chunk";
      readonly turnId: TurnId;
      readonly messageId: string;
      readonly role: MessageRole;
      readonly chunk: string;
    })
  | (EventMetadata & {
      readonly type: "tool.updated";
      readonly turnId: TurnId;
      readonly toolCallId: ToolCallId;
      readonly nodeId: AgentNodeId;
      readonly title: string;
      readonly kind: string;
      readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
      readonly content: string;
    })
  | (EventMetadata & {
      readonly type: "interaction.requested";
      readonly turnId: TurnId;
      readonly interactionId: PendingInteractionId;
      readonly nodeId: AgentNodeId;
      readonly title: string;
    })
  | (EventMetadata & {
      readonly type: "interaction.resolved";
      readonly interactionId: PendingInteractionId;
    })
  | (EventMetadata & {
      readonly type: "agent.discovered";
      readonly nodeId: AgentNodeId;
      readonly parentId: AgentNodeId | null;
      readonly name: string;
      readonly provider: Provider;
      readonly model: string | null;
    })
  | (EventMetadata & {
      readonly type: "agent.status-changed";
      readonly nodeId: AgentNodeId;
      readonly state: AgentState;
      readonly activity: string;
    })
  | (EventMetadata & {
      readonly type: "runtime.failed";
      readonly reason: string;
    });

export type UnsequencedDomainEvent = DomainEvent extends infer Event
  ? Event extends EventMetadata
    ? Omit<Event, keyof EventMetadata>
    : never
  : never;

import type {
  AgentNodeId,
  CheckpointId,
  EventId,
  MessageId,
  PendingInteractionId,
  ProjectId,
  Sequence,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";

export type PersistedProvider = "codex" | "claude";
export type PersistedThreadStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "needs-input"
  | "completed"
  | "interrupted"
  | "cancelling"
  | "cancelled"
  | "recovery-required"
  | "disconnected"
  | "failed";

export interface PersistedProject {
  readonly id: ProjectId;
  readonly name: string;
  readonly path: string;
  readonly gitBranch: string | null;
  readonly gitStatus: "clean" | "dirty" | "unavailable";
  readonly hidden: boolean;
  readonly order: number;
  readonly createdAt: string;
}

export interface PersistedThread {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly provider: PersistedProvider;
  readonly title: string;
  readonly status: PersistedThreadStatus;
  readonly model: string | null;
  readonly providerSessionId: string | null;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistedMessage {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly role: "user" | "agent" | "thought" | "system";
  readonly content: string;
  readonly createdAt: string;
}

export interface PersistedToolCall {
  readonly id: ToolCallId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly nodeId: AgentNodeId;
  readonly title: string;
  readonly kind: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly content: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistedPermissionOption {
  readonly optionId: string;
  readonly label: string;
  readonly kind: "allow-once" | "allow-always" | "reject-once" | "reject-always" | "other";
}

export interface PersistedInteraction {
  readonly id: PendingInteractionId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly nodeId: AgentNodeId;
  readonly kind: "permission" | "elicitation";
  readonly title: string;
  readonly description: string;
  readonly options: ReadonlyArray<PersistedPermissionOption>;
  readonly status: "pending" | "dispatching" | "resolved" | "cancelled" | "stale";
  readonly createdAt: string;
}

export interface PersistedAgentNode {
  readonly id: AgentNodeId;
  readonly threadId: ThreadId;
  readonly parentId: AgentNodeId | null;
  readonly name: string;
  readonly provider: PersistedProvider;
  readonly model: string | null;
  readonly state:
    | "starting"
    | "running"
    | "waiting"
    | "needs-input"
    | "completed"
    | "interrupted"
    | "failed";
  readonly activity: string;
  readonly childCount: number;
  readonly pendingApproval: boolean;
  readonly changedFileCount: number;
}

export interface PersistedCheckpointFile {
  readonly path: string;
  readonly size: number;
  readonly kind: "tracked" | "staged" | "untracked" | "ignored" | "unknown";
}

export interface PersistedCheckpoint {
  readonly id: CheckpointId;
  readonly projectPath: string;
  readonly createdAt: string;
  readonly files: ReadonlyArray<PersistedCheckpointFile>;
  readonly snapshotPath: string;
}

export interface CheckpointProjectionRecord {
  readonly checkpoint: PersistedCheckpoint;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly kind: "pre-turn" | "post-turn" | "undo";
}

export interface PersistedProviderDefaults {
  readonly model: string | null;
  readonly effort: "low" | "medium" | "high" | null;
  readonly permissionMode: "read-only" | "workspace-write" | "full-access" | null;
}

export interface PersistedUserSettings {
  readonly schemaVersion: 1;
  readonly theme: "light" | "dark" | "system";
  readonly graphDensity: "compact" | "comfortable";
  readonly statusColors: "default" | "high-contrast";
  readonly hiddenPanels: ReadonlyArray<"files" | "diff" | "terminal" | "plan">;
  readonly shortcuts: {
    readonly commandPalette: string;
    readonly agentMap: string;
    readonly review: string;
  };
  readonly providerDefaults: {
    readonly codex: PersistedProviderDefaults;
    readonly claude: PersistedProviderDefaults;
  };
}

interface EventMetadata {
  readonly schemaVersion: 1;
  readonly sequence: Sequence;
  readonly eventId: EventId;
  readonly receivedAt: string;
  readonly origin: "client" | "server" | "provider" | "git";
}

export type PersistedEventData =
  | { readonly type: "project.upserted"; readonly project: PersistedProject }
  | { readonly type: "project.removed"; readonly projectId: ProjectId }
  | { readonly type: "thread.upserted"; readonly thread: PersistedThread }
  | {
      readonly type: "thread.status-changed";
      readonly threadId: ThreadId;
      readonly status: PersistedThreadStatus;
      readonly updatedAt: string;
    }
  | { readonly type: "thread.removed"; readonly threadId: ThreadId }
  | { readonly type: "turn.started"; readonly threadId: ThreadId; readonly turnId: TurnId }
  | {
      readonly type: "turn.completed";
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly outcome: "completed" | "cancelled" | "interrupted" | "failed" | "recovery-required";
    }
  | { readonly type: "message.upserted"; readonly message: PersistedMessage }
  | { readonly type: "tool.upserted"; readonly toolCall: PersistedToolCall }
  | { readonly type: "interaction.upserted"; readonly interaction: PersistedInteraction }
  | { readonly type: "agent-node.upserted"; readonly node: PersistedAgentNode }
  | { readonly type: "checkpoint.saved"; readonly record: CheckpointProjectionRecord }
  | { readonly type: "settings.saved"; readonly settings: PersistedUserSettings };

export type DomainEvent = EventMetadata & PersistedEventData;
export type UnsequencedDomainEvent = PersistedEventData & Pick<EventMetadata, "origin">;

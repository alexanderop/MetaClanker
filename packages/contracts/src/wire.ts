import { Schema } from "effect";

import {
  AgentNodeId,
  CommandId,
  MessageId,
  PendingInteractionId,
  ProjectId,
  Sequence,
  ThreadId,
  ToolCallId,
  TurnId,
} from "./ids.js";

export const Provider = Schema.Literal("codex", "claude");
export type Provider = typeof Provider.Type;

export const ThreadStatus = Schema.Literal(
  "idle",
  "starting",
  "running",
  "waiting",
  "needs-input",
  "completed",
  "interrupted",
  "cancelling",
  "cancelled",
  "recovery-required",
  "disconnected",
  "failed",
);
export type ThreadStatus = typeof ThreadStatus.Type;

export const AgentState = Schema.Literal(
  "starting",
  "running",
  "waiting",
  "needs-input",
  "completed",
  "interrupted",
  "failed",
);
export type AgentState = typeof AgentState.Type;

export const Project = Schema.Struct({
  id: ProjectId,
  name: Schema.NonEmptyTrimmedString,
  path: Schema.NonEmptyString,
  gitBranch: Schema.NullOr(Schema.String),
  gitStatus: Schema.Literal("clean", "dirty", "unavailable"),
  hidden: Schema.Boolean,
  order: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  createdAt: Schema.String,
});
export type Project = typeof Project.Type;

export const Thread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  provider: Provider,
  title: Schema.NonEmptyTrimmedString,
  status: ThreadStatus,
  model: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Thread = typeof Thread.Type;

export const MessageRole = Schema.Literal("user", "agent", "thought", "system");
export type MessageRole = typeof MessageRole.Type;

export const Message = Schema.Struct({
  id: MessageId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  role: MessageRole,
  content: Schema.String,
  sequence: Sequence,
  createdAt: Schema.String,
});
export type Message = typeof Message.Type;

export const ToolCall = Schema.Struct({
  id: ToolCallId,
  threadId: ThreadId,
  turnId: TurnId,
  nodeId: AgentNodeId,
  title: Schema.String,
  kind: Schema.String,
  status: Schema.Literal("pending", "running", "completed", "failed", "cancelled"),
  content: Schema.String,
  sequence: Sequence,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ToolCall = typeof ToolCall.Type;

export const PermissionOption = Schema.Struct({
  optionId: Schema.String,
  label: Schema.String,
  kind: Schema.Literal("allow-once", "allow-always", "reject-once", "reject-always", "other"),
});
export type PermissionOption = typeof PermissionOption.Type;

export const PendingInteraction = Schema.Struct({
  id: PendingInteractionId,
  projectId: ProjectId,
  threadId: ThreadId,
  turnId: TurnId,
  nodeId: AgentNodeId,
  kind: Schema.Literal("permission", "elicitation"),
  title: Schema.String,
  description: Schema.String,
  options: Schema.Array(PermissionOption),
  status: Schema.Literal("pending", "resolved", "cancelled", "stale"),
  sequence: Sequence,
  createdAt: Schema.String,
});
export type PendingInteraction = typeof PendingInteraction.Type;

export const AgentNode = Schema.Struct({
  id: AgentNodeId,
  threadId: ThreadId,
  parentId: Schema.NullOr(AgentNodeId),
  name: Schema.String,
  provider: Provider,
  model: Schema.NullOr(Schema.String),
  state: AgentState,
  activity: Schema.String,
  childCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  pendingApproval: Schema.Boolean,
  changedFileCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type AgentNode = typeof AgentNode.Type;

export const ServerEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("snapshot-required"),
    reason: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("project-upserted"),
    sequence: Sequence,
    project: Project,
  }),
  Schema.Struct({
    type: Schema.Literal("project-removed"),
    sequence: Sequence,
    projectId: ProjectId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread-status"),
    sequence: Sequence,
    threadId: ThreadId,
    status: ThreadStatus,
  }),
  Schema.Struct({
    type: Schema.Literal("thread-upserted"),
    sequence: Sequence,
    thread: Thread,
  }),
  Schema.Struct({
    type: Schema.Literal("thread-removed"),
    sequence: Sequence,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("message-upserted"),
    sequence: Sequence,
    message: Message,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-upserted"),
    sequence: Sequence,
    toolCall: ToolCall,
  }),
  Schema.Struct({
    type: Schema.Literal("interaction-upserted"),
    sequence: Sequence,
    interaction: PendingInteraction,
  }),
  Schema.Struct({
    type: Schema.Literal("agent-node-upserted"),
    sequence: Sequence,
    node: AgentNode,
  }),
  Schema.Struct({
    type: Schema.Literal("synchronized"),
    sequence: Sequence,
  }),
);
export type ServerEvent = typeof ServerEvent.Type;

export const CreateProjectRequest = Schema.Struct({
  commandId: CommandId,
  path: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyTrimmedString),
});
export type CreateProjectRequest = typeof CreateProjectRequest.Type;

export const DirectoryBrowserResponse = Schema.Struct({
  currentPath: Schema.String,
  parentPath: Schema.NullOr(Schema.String),
  entries: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
    }),
  ),
});
export type DirectoryBrowserResponse = typeof DirectoryBrowserResponse.Type;

export const ProviderReadiness = Schema.Struct({
  provider: Provider,
  status: Schema.Literal("ready", "unavailable"),
  reason: Schema.NullOr(Schema.String),
});
export type ProviderReadiness = typeof ProviderReadiness.Type;

export const ProviderReadinessResponse = Schema.Array(ProviderReadiness);
export type ProviderReadinessResponse = typeof ProviderReadinessResponse.Type;

export const UpdateProjectRequest = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyTrimmedString),
  hidden: Schema.optional(Schema.Boolean),
  order: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
});
export type UpdateProjectRequest = typeof UpdateProjectRequest.Type;

export const CreateThreadRequest = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  provider: Provider,
  title: Schema.optional(Schema.NonEmptyTrimmedString),
  model: Schema.optional(Schema.String),
});
export type CreateThreadRequest = typeof CreateThreadRequest.Type;

export const UpdateThreadRequest = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyTrimmedString),
  archived: Schema.optional(Schema.Boolean),
});
export type UpdateThreadRequest = typeof UpdateThreadRequest.Type;

export const SendPromptRequest = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  prompt: Schema.NonEmptyString,
  attachments: Schema.optional(Schema.Array(Schema.String)),
});
export type SendPromptRequest = typeof SendPromptRequest.Type;

export const StartThreadRequest = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  provider: Provider,
  model: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.Literal("low", "medium", "high")),
  permissionMode: Schema.optional(Schema.Literal("read-only", "workspace-write", "full-access")),
  prompt: Schema.String,
  attachments: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
});
export type StartThreadRequest = typeof StartThreadRequest.Type;

export const StartThreadResponse = Schema.Struct({
  accepted: Schema.Literal(true),
  thread: Thread,
  turnId: TurnId,
});
export type StartThreadResponse = typeof StartThreadResponse.Type;

export const RespondInteractionRequest = Schema.Struct({
  commandId: CommandId,
  interactionId: PendingInteractionId,
  optionId: Schema.String,
});
export type RespondInteractionRequest = typeof RespondInteractionRequest.Type;

export const ThreadDetail = Schema.Struct({
  thread: Thread,
  messages: Schema.Array(Message),
  toolCalls: Schema.Array(ToolCall),
  interactions: Schema.Array(PendingInteraction),
  agentNodes: Schema.Array(AgentNode),
  latestSequence: Sequence,
});
export type ThreadDetail = typeof ThreadDetail.Type;

export const ShellSnapshot = Schema.Struct({
  projects: Schema.Array(Project),
  threads: Schema.Array(Thread),
  latestSequence: Sequence,
});
export type ShellSnapshot = typeof ShellSnapshot.Type;

export const CommandReceipt = Schema.Struct({
  commandId: CommandId,
  status: Schema.Literal("accepted", "rejected"),
  aggregateId: Schema.String,
  reason: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type CommandReceipt = typeof CommandReceipt.Type;

export const ErrorResponse = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
});
export type ErrorResponse = typeof ErrorResponse.Type;

export const Theme = Schema.Literal("light", "dark", "system");
export type Theme = typeof Theme.Type;

const ProviderDefaults = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.Literal("low", "medium", "high")),
  permissionMode: Schema.NullOr(Schema.Literal("read-only", "workspace-write", "full-access")),
});

export const UserSettings = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  theme: Theme,
  graphDensity: Schema.Literal("compact", "comfortable"),
  statusColors: Schema.Literal("default", "high-contrast"),
  hiddenPanels: Schema.Array(Schema.Literal("files", "diff", "terminal", "plan")),
  shortcuts: Schema.Struct({
    commandPalette: Schema.String,
    agentMap: Schema.String,
    review: Schema.String,
  }),
  providerDefaults: Schema.Struct({
    codex: ProviderDefaults,
    claude: ProviderDefaults,
  }),
});
export type UserSettings = typeof UserSettings.Type;

export const defaultUserSettings: UserSettings = {
  schemaVersion: 1,
  theme: "system",
  graphDensity: "comfortable",
  statusColors: "default",
  hiddenPanels: [],
  shortcuts: {
    commandPalette: "Meta+K",
    agentMap: "Meta+Shift+M",
    review: "Meta+Shift+R",
  },
  providerDefaults: {
    codex: { model: null, effort: null, permissionMode: null },
    claude: { model: null, effort: null, permissionMode: null },
  },
};

const CheckpointFileWire = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  kind: Schema.Literal("tracked", "staged", "untracked", "ignored", "unknown"),
});

const CheckpointWire = Schema.Struct({
  id: Schema.String,
  projectPath: Schema.String,
  createdAt: Schema.String,
  files: Schema.Array(CheckpointFileWire),
  snapshotPath: Schema.String,
});

export const PersistedCheckpointWire = Schema.Struct({
  checkpoint: CheckpointWire,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  kind: Schema.Literal("pre-turn", "post-turn", "undo"),
});

export const WorkspaceDiffWire = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      status: Schema.Literal("added", "modified", "deleted"),
      beforeSize: Schema.Number,
      afterSize: Schema.Number,
    }),
  ),
});
export type WorkspaceDiffWire = typeof WorkspaceDiffWire.Type;

export const ReviewResponse = Schema.Struct({
  checkpoints: Schema.Array(PersistedCheckpointWire),
  diff: WorkspaceDiffWire,
});
export type ReviewResponse = typeof ReviewResponse.Type;

export const RestorePreviewResponse = Schema.Struct({
  additions: Schema.Array(CheckpointFileWire),
  modifications: Schema.Array(CheckpointFileWire),
  deletions: Schema.Array(CheckpointFileWire),
  includesIgnoredFiles: Schema.Boolean,
});
export type RestorePreviewResponse = typeof RestorePreviewResponse.Type;

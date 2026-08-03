import * as Schema from "effect/Schema";

import {
  AgentNodeId,
  CheckpointId,
  MessageId,
  PendingInteractionId,
  ProjectId,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";
import type { UnsequencedDomainEvent } from "@metaclanker/domain/persisted-events";

const Origin = Schema.Literals(["client", "server", "provider", "git"]);
const EventBase = { origin: Origin } as const;
const Provider = Schema.Literals(["codex", "claude"]);
const ThreadStatus = Schema.Literals([
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
]);

const PersistedProject = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
  gitBranch: Schema.NullOr(Schema.String),
  gitStatus: Schema.Literals(["clean", "dirty", "unavailable"]),
  hidden: Schema.Boolean,
  order: Schema.Natural,
  createdAt: Schema.String,
});

const PersistedThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  provider: Provider,
  title: Schema.String,
  status: ThreadStatus,
  model: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

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
  nodeId: AgentNodeId,
  title: Schema.String,
  kind: Schema.String,
  status: Schema.Literals(["pending", "running", "completed", "failed", "cancelled"]),
  content: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const InteractionWithoutSequence = Schema.Struct({
  id: PendingInteractionId,
  projectId: ProjectId,
  threadId: ThreadId,
  turnId: TurnId,
  nodeId: AgentNodeId,
  kind: Schema.Literals(["permission", "elicitation"]),
  title: Schema.String,
  description: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      optionId: Schema.String,
      label: Schema.String,
      kind: Schema.Literals([
        "allow-once",
        "allow-always",
        "reject-once",
        "reject-always",
        "other",
      ]),
    }),
  ),
  status: Schema.Literals(["pending", "dispatching", "resolved", "cancelled", "stale"]),
  createdAt: Schema.String,
});

const PersistedAgentNode = Schema.Struct({
  id: AgentNodeId,
  threadId: ThreadId,
  parentId: Schema.NullOr(AgentNodeId),
  name: Schema.String,
  provider: Provider,
  model: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "starting",
    "running",
    "waiting",
    "needs-input",
    "completed",
    "interrupted",
    "failed",
  ]),
  activity: Schema.String,
  childCount: Schema.Natural,
  pendingApproval: Schema.Boolean,
  changedFileCount: Schema.Natural,
});

const PersistedCheckpoint = Schema.Struct({
  id: CheckpointId,
  projectPath: Schema.String,
  createdAt: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      size: Schema.Natural,
      kind: Schema.Literals(["tracked", "staged", "untracked", "ignored", "unknown"]),
    }),
  ),
  snapshotPath: Schema.String,
});

const PersistedCheckpointRecord = Schema.Struct({
  checkpoint: PersistedCheckpoint,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  kind: Schema.Literals(["pre-turn", "post-turn", "undo"]),
});

const ProviderDefaults = Schema.Struct({
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.Literals(["low", "medium", "high"])),
  permissionMode: Schema.NullOr(Schema.Literals(["read-only", "workspace-write", "full-access"])),
});

const PersistedUserSettings = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  theme: Schema.Literals(["light", "dark", "system"]),
  graphDensity: Schema.Literals(["compact", "comfortable"]),
  statusColors: Schema.Literals(["default", "high-contrast"]),
  hiddenPanels: Schema.Array(Schema.Literals(["files", "diff", "terminal", "plan"])),
  shortcuts: Schema.Struct({
    commandPalette: Schema.String,
    agentMap: Schema.String,
    review: Schema.String,
  }),
  providerDefaults: Schema.Struct({ codex: ProviderDefaults, claude: ProviderDefaults }),
});

const EventData = Schema.Union([
  Schema.Struct({ ...EventBase, type: Schema.tag("project.upserted"), project: PersistedProject }),
  Schema.Struct({ ...EventBase, type: Schema.Literal("project.removed"), projectId: ProjectId }),
  Schema.Struct({ ...EventBase, type: Schema.Literal("thread.upserted"), thread: PersistedThread }),
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
    node: PersistedAgentNode,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("checkpoint.saved"),
    record: PersistedCheckpointRecord,
  }),
  Schema.Struct({
    ...EventBase,
    type: Schema.Literal("settings.saved"),
    settings: PersistedUserSettings,
  }),
]).pipe(Schema.toTaggedUnion("type"));

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

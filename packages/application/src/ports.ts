import type { Effect } from "effect";

import type {
  CommandId,
  MessageId,
  PendingInteractionId,
  ProjectId,
  Sequence,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";
import type {
  AgentNode,
  CommandReceipt,
  Message,
  PendingInteraction,
  Project,
  Provider,
  ShellSnapshot,
  Thread,
  ThreadDetail,
  ThreadStatus,
  ToolCall,
  UserSettings,
} from "@metaclanker/contracts/wire";

export interface CreateProjectRecord {
  readonly id: ProjectId;
  readonly commandId: CommandId;
  readonly name: string;
  readonly path: string;
  readonly gitBranch: string | null;
  readonly gitStatus: "clean" | "dirty" | "unavailable";
  readonly createdAt: string;
}

export interface CreateThreadRecord {
  readonly id: ThreadId;
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly provider: Provider;
  readonly title: string;
  readonly model: string | null;
  readonly createdAt: string;
}

export interface AppendMessageRecord {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly role: Message["role"];
  readonly content: string;
  readonly createdAt: string;
}

export interface UpsertToolCallRecord extends Omit<ToolCall, "createdAt" | "updatedAt"> {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoreError {
  readonly _tag: "StoreError";
  readonly operation: string;
  readonly message: string;
}

export interface MetaClankerStore {
  readonly shellSnapshot: Effect.Effect<ShellSnapshot, StoreError>;
  readonly createProject: (input: CreateProjectRecord) => Effect.Effect<Project, StoreError>;
  readonly renameProject: (id: ProjectId, name: string) => Effect.Effect<Project, StoreError>;
  readonly updateProject: (
    id: ProjectId,
    input: {
      readonly name?: string | undefined;
      readonly hidden?: boolean | undefined;
      readonly order?: number | undefined;
    },
  ) => Effect.Effect<Project, StoreError>;
  readonly removeProject: (id: ProjectId) => Effect.Effect<void, StoreError>;
  readonly createThread: (input: CreateThreadRecord) => Effect.Effect<Thread, StoreError>;
  readonly getThread: (id: ThreadId) => Effect.Effect<ThreadDetail | null, StoreError>;
  readonly renameThread: (id: ThreadId, title: string) => Effect.Effect<Thread, StoreError>;
  readonly setThreadArchived: (
    id: ThreadId,
    archived: boolean,
  ) => Effect.Effect<Thread, StoreError>;
  readonly deleteThread: (id: ThreadId) => Effect.Effect<void, StoreError>;
  readonly setThreadStatus: (
    id: ThreadId,
    status: ThreadStatus,
  ) => Effect.Effect<Sequence, StoreError>;
  readonly setProviderSession: (
    id: ThreadId,
    providerSessionId: string,
  ) => Effect.Effect<Thread, StoreError>;
  readonly appendMessage: (input: AppendMessageRecord) => Effect.Effect<Message, StoreError>;
  readonly upsertToolCall: (input: UpsertToolCallRecord) => Effect.Effect<ToolCall, StoreError>;
  readonly upsertInteraction: (
    input: PendingInteraction,
  ) => Effect.Effect<PendingInteraction, StoreError>;
  readonly resolveInteraction: (
    id: PendingInteractionId,
    status: "resolved" | "cancelled" | "stale",
  ) => Effect.Effect<PendingInteraction, StoreError>;
  readonly upsertAgentNode: (input: AgentNode) => Effect.Effect<AgentNode, StoreError>;
  readonly appendEvent: (
    threadId: ThreadId,
    type: string,
    payload: string,
  ) => Effect.Effect<Sequence, StoreError>;
  readonly findReceipt: (commandId: CommandId) => Effect.Effect<CommandReceipt | null, StoreError>;
  readonly saveReceipt: (receipt: CommandReceipt) => Effect.Effect<void, StoreError>;
  readonly backup: (destination: string) => Effect.Effect<void, StoreError>;
  readonly getSettings: Effect.Effect<UserSettings, StoreError>;
  readonly saveSettings: (settings: UserSettings) => Effect.Effect<UserSettings, StoreError>;
  readonly saveCheckpoint: (
    record: PersistedCheckpoint,
  ) => Effect.Effect<PersistedCheckpoint, StoreError>;
  readonly listCheckpoints: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<PersistedCheckpoint>, StoreError>;
}

export interface CheckpointFile {
  readonly path: string;
  readonly size: number;
  readonly kind: "tracked" | "staged" | "untracked" | "ignored" | "unknown";
}

export interface Checkpoint {
  readonly id: string;
  readonly projectPath: string;
  readonly createdAt: string;
  readonly files: ReadonlyArray<CheckpointFile>;
  readonly snapshotPath: string;
}

export interface WorkspaceDiffFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly beforeSize: number;
  readonly afterSize: number;
}

export interface WorkspaceDiff {
  readonly files: ReadonlyArray<WorkspaceDiffFile>;
}

export interface RestorePreview {
  readonly additions: ReadonlyArray<CheckpointFile>;
  readonly modifications: ReadonlyArray<CheckpointFile>;
  readonly deletions: ReadonlyArray<CheckpointFile>;
  readonly includesIgnoredFiles: boolean;
}

export interface CheckpointError {
  readonly _tag: "CheckpointError";
  readonly operation: "capture" | "diff" | "preview" | "restore";
  readonly message: string;
}

export interface Checkpoints {
  readonly capture: (projectPath: string) => Effect.Effect<Checkpoint, CheckpointError>;
  readonly diff: (
    before: Checkpoint,
    after: Checkpoint,
  ) => Effect.Effect<WorkspaceDiff, CheckpointError>;
  readonly previewRestore: (
    checkpoint: Checkpoint,
  ) => Effect.Effect<RestorePreview, CheckpointError>;
  readonly restore: (checkpoint: Checkpoint) => Effect.Effect<Checkpoint, CheckpointError>;
}

export interface PersistedCheckpoint {
  readonly checkpoint: Checkpoint;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly kind: "pre-turn" | "post-turn" | "undo";
}

export interface GitWorkspaceStatus {
  readonly branch: string | null;
  readonly status: "clean" | "dirty" | "unavailable";
}

export interface ProjectFiles {
  readonly validateProject: (path: string) => Effect.Effect<GitWorkspaceStatus, ProjectPathError>;
}

export interface ProjectPathError {
  readonly _tag: "ProjectPathError";
  readonly path: string;
  readonly reason: "not-absolute" | "not-found" | "not-directory" | "not-readable";
}

export interface PromptInput {
  readonly turnId: TurnId;
  readonly text: string;
  readonly attachments: ReadonlyArray<string>;
}

export interface PromptOutcome {
  readonly stopReason: "completed" | "cancelled" | "interrupted" | "failed";
}

export interface SessionCapabilities {
  readonly protocolVersion: 1;
  readonly resume: boolean;
  readonly load: boolean;
  readonly close: boolean;
  readonly delete: boolean;
  readonly graph: "available" | "degraded";
  readonly models: ReadonlyArray<string>;
  readonly modes: ReadonlyArray<string>;
}

export type NormalizedAgentEvent =
  | { readonly type: "agent-message-chunk"; readonly chunk: string }
  | {
      readonly type: "tool-call";
      readonly toolCallId: ToolCallId;
      readonly title: string;
      readonly kind: string;
      readonly status: ToolCall["status"];
      readonly content: string;
    }
  | { readonly type: "thought-chunk"; readonly chunk: string }
  | { readonly type: "plan"; readonly content: string }
  | { readonly type: "usage"; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: "agent-node"; readonly node: AgentNode }
  | { readonly type: "permission"; readonly interaction: PendingInteraction }
  | { readonly type: "runtime-failure"; readonly message: string };

export interface AcpRuntimeError {
  readonly _tag: "AcpRuntimeError";
  readonly code: "spawn" | "protocol" | "process-exit" | "disconnected" | "unsupported";
  readonly message: string;
}

export interface AcpSessionHandle {
  readonly providerSessionId: string;
  readonly capabilities: SessionCapabilities;
  readonly prompt: (
    input: PromptInput,
    emit: (event: NormalizedAgentEvent) => Effect.Effect<void>,
  ) => Effect.Effect<PromptOutcome, AcpRuntimeError>;
  readonly requestCancel: () => Effect.Effect<void, AcpRuntimeError>;
  readonly respondInteraction: (
    id: PendingInteractionId,
    optionId: string,
  ) => Effect.Effect<void, AcpRuntimeError>;
  readonly close: Effect.Effect<void>;
}

export interface OpenAcpSessionInput {
  readonly provider: Provider;
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string | null;
}

export interface AcpSessions {
  readonly open: (input: OpenAcpSessionInput) => Effect.Effect<AcpSessionHandle, AcpRuntimeError>;
}

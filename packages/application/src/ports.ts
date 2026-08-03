import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";

import type {
  CommandId,
  CheckpointId,
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
import type { DomainEvent } from "@metaclanker/domain/events";

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

export interface StartThreadRecord extends CreateThreadRecord {
  readonly turnId: TurnId;
  readonly userMessageId: MessageId;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<string>;
}

export interface StartedThreadRecord {
  readonly thread: Thread;
  readonly turnId: TurnId;
  readonly acceptedNow: boolean;
  readonly threadEventSequence: Sequence | null;
}

export interface StartTurnRecord {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly userMessageId: MessageId;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<string>;
  readonly rootNode: AgentNode;
  readonly createdAt: string;
}

export type StartedTurnRecord =
  | {
      readonly acceptedNow: false;
      readonly thread: Thread;
      readonly turnId: TurnId;
    }
  | {
      readonly acceptedNow: true;
      readonly thread: Thread;
      readonly turnId: TurnId;
      readonly userMessage: Message;
      readonly rootNode: AgentNode;
      readonly statusEventSequence: Sequence;
      readonly messageEventSequence: Sequence;
      readonly nodeEventSequence: Sequence;
    };

export type TurnCompletionStatus =
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed"
  | "recovery-required";

export type ProviderContinuationSafety = "safe" | "unsafe";

export type PromptIntentPhase =
  | "admitted"
  | "scheduling-failed"
  | "leased"
  | "opening-session"
  | "dispatching-provider"
  | "awaiting-provider"
  | "completed";

export interface PromptIntentLease {
  readonly intentId: TurnId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly leaseId: string;
  readonly attempt: number;
  readonly phase: "leased";
}

export interface AdmitInteractionResponseRecord {
  readonly commandId: CommandId;
  readonly interactionId: PendingInteractionId;
  readonly optionId: string;
  readonly leaseId: string;
  readonly createdAt: string;
}

export type AdmittedInteractionResponse =
  | {
      readonly acceptedNow: false;
      readonly interaction: PendingInteraction;
      readonly eventSequence: null;
    }
  | {
      readonly acceptedNow: true;
      readonly interaction: PendingInteraction;
      readonly eventSequence: Sequence;
      readonly leaseId: string;
    };

export interface AdmitCancelRecord {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly leaseId: string;
  readonly createdAt: string;
}

export type AdmittedCancel =
  | { readonly acceptedNow: false; readonly turnId: TurnId; readonly eventSequence: null }
  | {
      readonly acceptedNow: true;
      readonly turnId: TurnId;
      readonly eventSequence: Sequence;
      readonly leaseId: string;
    };

export interface AdmitRestoreRecord {
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly checkpointId: CheckpointId;
  readonly undoCheckpointId: CheckpointId;
  readonly leaseId: string;
  readonly createdAt: string;
}

export type AdmittedRestore =
  | { readonly acceptedNow: false; readonly undoCheckpointId: CheckpointId }
  | {
      readonly acceptedNow: true;
      readonly undoCheckpointId: CheckpointId;
      readonly leaseId: string;
    };

export interface AppendMessageRecord {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly role: Message["role"];
  readonly content: string;
  readonly createdAt: string;
}

export interface UpsertToolCallRecord extends Omit<
  ToolCall,
  "sequence" | "createdAt" | "updatedAt"
> {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class StoreError extends Schema.TaggedErrorClass<StoreError>()("StoreError", {
  code: Schema.Literals(["not-found", "conflict", "persistence"]),
  operation: Schema.String,
  message: Schema.String,
}) {}

export interface PersistedMutation<A> {
  readonly record: A;
  readonly eventSequence: Sequence;
}

export interface CommandMutation<A> {
  readonly record: A;
  readonly eventSequence: Sequence | null;
}

export interface MetaClankerStore {
  readonly shellSnapshot: Effect.Effect<ShellSnapshot, StoreError>;
  readonly listProviderModels: Effect.Effect<
    ReadonlyArray<{ readonly provider: Provider; readonly model: string }>,
    StoreError
  >;
  readonly replaceProviderModels: (
    provider: Provider,
    models: ReadonlyArray<string>,
    discoveredAt: string,
  ) => Effect.Effect<void, StoreError>;
  readonly createProject: (
    input: CreateProjectRecord,
  ) => Effect.Effect<CommandMutation<Project>, StoreError>;
  readonly renameProject: (
    id: ProjectId,
    name: string,
  ) => Effect.Effect<PersistedMutation<Project>, StoreError>;
  readonly updateProject: (
    id: ProjectId,
    input: {
      readonly name?: string | undefined;
      readonly hidden?: boolean | undefined;
      readonly order?: number | undefined;
    },
  ) => Effect.Effect<PersistedMutation<Project>, StoreError>;
  readonly removeProject: (
    id: ProjectId,
  ) => Effect.Effect<PersistedMutation<ProjectId>, StoreError>;
  readonly createThread: (
    input: CreateThreadRecord,
  ) => Effect.Effect<CommandMutation<Thread>, StoreError>;
  readonly startThread: (
    input: StartThreadRecord,
  ) => Effect.Effect<StartedThreadRecord, StoreError>;
  readonly startTurn: (input: StartTurnRecord) => Effect.Effect<StartedTurnRecord, StoreError>;
  readonly completeTurn: (
    turnId: TurnId,
    status: TurnCompletionStatus,
    completedAt: string,
  ) => Effect.Effect<void, StoreError>;
  /** Atomically records cancellation before the provider cancel notification. */
  readonly admitCancel: (input: AdmitCancelRecord) => Effect.Effect<AdmittedCancel, StoreError>;
  readonly markCancelAwaiting: (
    turnId: TurnId,
    leaseId: string,
    updatedAt: string,
  ) => Effect.Effect<boolean, StoreError>;
  readonly markCancelUncertain: (
    turnId: TurnId,
    leaseId: string,
    updatedAt: string,
  ) => Effect.Effect<boolean, StoreError>;
  /** Locks an idle root and records the destructive filesystem boundary. */
  readonly admitRestore: (input: AdmitRestoreRecord) => Effect.Effect<AdmittedRestore, StoreError>;
  /** Persists the undo checkpoint and completes its restore intent atomically. */
  readonly completeRestore: (
    commandId: CommandId,
    leaseId: string,
    record: PersistedCheckpoint,
  ) => Effect.Effect<PersistedCheckpoint | null, StoreError>;
  /** Marks a restore whose filesystem result cannot be proven after a failure. */
  readonly markRestoreUncertain: (
    commandId: CommandId,
    leaseId: string,
    threadId: ThreadId,
    updatedAt: string,
  ) => Effect.Effect<Sequence | null, StoreError>;
  readonly claimPromptIntent: (
    turnId: TurnId,
    leaseId: string,
    leaseExpiresAt: string,
  ) => Effect.Effect<PromptIntentLease | null, StoreError>;
  readonly transitionPromptIntent: (
    turnId: TurnId,
    leaseId: string,
    phase: Exclude<PromptIntentPhase, "admitted" | "scheduling-failed" | "leased">,
    updatedAt: string,
    failureReason?: string,
  ) => Effect.Effect<boolean, StoreError>;
  readonly getThread: (id: ThreadId) => Effect.Effect<ThreadDetail | null, StoreError>;
  readonly renameThread: (
    id: ThreadId,
    title: string,
  ) => Effect.Effect<PersistedMutation<Thread>, StoreError>;
  readonly setThreadArchived: (
    id: ThreadId,
    archived: boolean,
  ) => Effect.Effect<PersistedMutation<Thread>, StoreError>;
  readonly deleteThread: (id: ThreadId) => Effect.Effect<PersistedMutation<ThreadId>, StoreError>;
  readonly setThreadStatus: (
    id: ThreadId,
    status: ThreadStatus,
  ) => Effect.Effect<Sequence, StoreError>;
  readonly setProviderSession: (
    id: ThreadId,
    providerSessionId: string,
    continuationSafety: ProviderContinuationSafety,
  ) => Effect.Effect<PersistedMutation<Thread>, StoreError>;
  readonly getProviderContinuationSafety: (
    id: ThreadId,
  ) => Effect.Effect<ProviderContinuationSafety | null, StoreError>;
  readonly appendMessage: (
    input: AppendMessageRecord,
  ) => Effect.Effect<PersistedMutation<Message>, StoreError>;
  readonly upsertToolCall: (
    input: UpsertToolCallRecord,
  ) => Effect.Effect<PersistedMutation<ToolCall>, StoreError>;
  readonly upsertInteraction: (
    input: Omit<PendingInteraction, "sequence">,
  ) => Effect.Effect<PersistedMutation<PendingInteraction>, StoreError>;
  readonly findInteraction: (
    id: PendingInteractionId,
  ) => Effect.Effect<PendingInteraction | null, StoreError>;
  readonly resolveInteraction: (
    id: PendingInteractionId,
    status: "resolved" | "cancelled" | "stale",
  ) => Effect.Effect<PersistedMutation<PendingInteraction>, StoreError>;
  /** Atomically records the selected option and the provider dispatch boundary. */
  readonly admitInteractionResponse: (
    input: AdmitInteractionResponseRecord,
  ) => Effect.Effect<AdmittedInteractionResponse, StoreError>;
  /** Settles an admitted response only after the provider request outcome is known. */
  readonly settleInteractionResponse: (
    interactionId: PendingInteractionId,
    leaseId: string,
    status: "resolved" | "stale",
    intentState: "succeeded" | "uncertain" | "failed",
    updatedAt: string,
    failureReason?: string,
  ) => Effect.Effect<PersistedMutation<PendingInteraction>, StoreError>;
  readonly upsertAgentNode: (
    input: AgentNode,
  ) => Effect.Effect<PersistedMutation<AgentNode>, StoreError>;
  readonly readEvents: (
    afterSequence: Sequence,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<DomainEvent>, StoreError>;
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
  readonly id: CheckpointId;
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

export class CheckpointError extends Schema.TaggedErrorClass<CheckpointError>()("CheckpointError", {
  operation: Schema.Literals(["capture", "diff", "preview", "restore"]),
  message: Schema.String,
}) {}

export interface Checkpoints {
  readonly capture: (
    projectPath: string,
    id?: CheckpointId,
  ) => Effect.Effect<Checkpoint, CheckpointError>;
  readonly diff: (
    before: Checkpoint,
    after: Checkpoint,
  ) => Effect.Effect<WorkspaceDiff, CheckpointError>;
  readonly previewRestore: (
    checkpoint: Checkpoint,
  ) => Effect.Effect<RestorePreview, CheckpointError>;
  readonly restore: (
    checkpoint: Checkpoint,
    undoCheckpointId?: CheckpointId,
  ) => Effect.Effect<Checkpoint, CheckpointError>;
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

export class ProjectPathError extends Schema.TaggedErrorClass<ProjectPathError>()(
  "ProjectPathError",
  {
    path: Schema.String,
    reason: Schema.Literals(["not-absolute", "not-found", "not-directory", "not-readable"]),
  },
) {}

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
  | {
      readonly type: "permission";
      readonly interaction: Omit<PendingInteraction, "sequence">;
    }
  | { readonly type: "capability-degraded"; readonly capability: "graph" }
  | { readonly type: "runtime-failure"; readonly message: string };

export class AcpRuntimeError extends Schema.TaggedErrorClass<AcpRuntimeError>()("AcpRuntimeError", {
  code: Schema.Literals([
    "spawn",
    "protocol",
    "process-exit",
    "disconnected",
    "unsupported",
    "event-overflow",
  ]),
  message: Schema.String,
}) {}

export interface AcpSessionHandle {
  readonly providerSessionId: string;
  readonly capabilities: SessionCapabilities;
  readonly events: Stream.Stream<NormalizedAgentEvent, AcpRuntimeError>;
  /** Waits until every event already accepted by the bounded queue has been consumed. */
  readonly drainAcceptedEvents: Effect.Effect<void, AcpRuntimeError>;
  readonly prompt: (input: PromptInput) => Effect.Effect<PromptOutcome, AcpRuntimeError>;
  readonly requestCancel: () => Effect.Effect<void, AcpRuntimeError>;
  readonly respondInteraction: (
    id: PendingInteractionId,
    optionId: string,
  ) => Effect.Effect<void, AcpRuntimeError>;
  readonly close: Effect.Effect<void, AcpRuntimeError>;
  /** Immediately tears down transport and the child process without protocol handshakes. */
  readonly abort: Effect.Effect<void>;
}

export interface OpenAcpSessionInput {
  readonly provider: Provider;
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly permissionMode: string | null;
}

export interface AcpSessions {
  readonly open: (
    input: OpenAcpSessionInput,
  ) => Effect.Effect<AcpSessionHandle, AcpRuntimeError, Scope.Scope>;
}

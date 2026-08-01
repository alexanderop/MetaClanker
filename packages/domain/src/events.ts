import type { EventId, ProjectId, Sequence, ThreadId, TurnId } from "@metaclanker/contracts/ids";
import type {
  AgentNode,
  Message,
  PendingInteraction,
  Project,
  ShellSnapshot,
  Thread,
  ThreadDetail,
  ThreadStatus,
  ToolCall,
  UserSettings,
  ServerEvent,
} from "@metaclanker/contracts/wire";

interface EventMetadata {
  readonly schemaVersion: 1;
  readonly sequence: Sequence;
  readonly eventId: EventId;
  readonly receivedAt: string;
  readonly origin: "client" | "server" | "provider" | "git";
}

export interface CheckpointProjectionRecord {
  readonly checkpoint: {
    readonly id: string;
    readonly projectPath: string;
    readonly createdAt: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly size: number;
      readonly kind: "tracked" | "staged" | "untracked" | "ignored" | "unknown";
    }>;
    readonly snapshotPath: string;
  };
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly kind: "pre-turn" | "post-turn" | "undo";
}

type EventData =
  | { readonly type: "project.upserted"; readonly project: Project }
  | { readonly type: "project.removed"; readonly projectId: ProjectId }
  | { readonly type: "thread.upserted"; readonly thread: Thread }
  | {
      readonly type: "thread.status-changed";
      readonly threadId: ThreadId;
      readonly status: ThreadStatus;
      readonly updatedAt: string;
    }
  | { readonly type: "thread.removed"; readonly threadId: ThreadId }
  | {
      readonly type: "turn.started";
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
    }
  | {
      readonly type: "turn.completed";
      readonly threadId: ThreadId;
      readonly turnId: TurnId;
      readonly outcome: "completed" | "cancelled" | "interrupted" | "failed" | "recovery-required";
    }
  | {
      readonly type: "message.upserted";
      readonly message: Omit<Message, "sequence">;
    }
  | {
      readonly type: "tool.upserted";
      readonly toolCall: Omit<ToolCall, "sequence">;
    }
  | {
      readonly type: "interaction.upserted";
      readonly interaction: Omit<PendingInteraction, "sequence">;
    }
  | { readonly type: "agent-node.upserted"; readonly node: AgentNode }
  | { readonly type: "checkpoint.saved"; readonly record: CheckpointProjectionRecord }
  | { readonly type: "settings.saved"; readonly settings: UserSettings };

export type DomainEvent = EventMetadata & EventData;
export type UnsequencedDomainEvent = EventData & Pick<EventMetadata, "origin">;
export type ThreadReplayEvent = Exclude<
  ServerEvent,
  {
    readonly type: "snapshot-required" | "synchronized" | "project-upserted" | "project-removed";
  }
>;
export type ShellReplayEvent = Extract<
  ServerEvent,
  {
    readonly type:
      | "project-upserted"
      | "project-removed"
      | "thread-upserted"
      | "thread-status"
      | "thread-removed";
  }
>;

export const domainEventToShellEvent = (event: DomainEvent): ShellReplayEvent | null => {
  if (event.type === "project.upserted") {
    return { type: "project-upserted", sequence: event.sequence, project: event.project };
  }
  if (event.type === "project.removed") {
    return { type: "project-removed", sequence: event.sequence, projectId: event.projectId };
  }
  if (event.type === "thread.upserted") {
    return { type: "thread-upserted", sequence: event.sequence, thread: event.thread };
  }
  if (event.type === "thread.status-changed") {
    return {
      type: "thread-status",
      sequence: event.sequence,
      threadId: event.threadId,
      status: event.status,
    };
  }
  if (event.type === "thread.removed") {
    return { type: "thread-removed", sequence: event.sequence, threadId: event.threadId };
  }
  return null;
};

/** Converts a canonical event into the provider-neutral live thread protocol. */
export const domainEventToThreadEvent = (
  event: DomainEvent,
  threadId: ThreadId,
): ThreadReplayEvent | null => {
  if (event.type === "thread.upserted") {
    return event.thread.id === threadId
      ? { type: "thread-upserted", sequence: event.sequence, thread: event.thread }
      : null;
  }
  if (event.type === "thread.status-changed") {
    return event.threadId === threadId
      ? {
          type: "thread-status",
          sequence: event.sequence,
          threadId: event.threadId,
          status: event.status,
        }
      : null;
  }
  if (event.type === "thread.removed") {
    return event.threadId === threadId
      ? { type: "thread-removed", sequence: event.sequence, threadId: event.threadId }
      : null;
  }
  if (event.type === "message.upserted") {
    return event.message.threadId === threadId
      ? {
          type: "message-upserted",
          sequence: event.sequence,
          message: { ...event.message, sequence: event.sequence },
        }
      : null;
  }
  if (event.type === "tool.upserted") {
    return event.toolCall.threadId === threadId
      ? {
          type: "tool-upserted",
          sequence: event.sequence,
          toolCall: { ...event.toolCall, sequence: event.sequence },
        }
      : null;
  }
  if (event.type === "interaction.upserted") {
    return event.interaction.threadId === threadId
      ? {
          type: "interaction-upserted",
          sequence: event.sequence,
          interaction: { ...event.interaction, sequence: event.sequence },
        }
      : null;
  }
  if (event.type === "agent-node.upserted") {
    return event.node.threadId === threadId
      ? { type: "agent-node-upserted", sequence: event.sequence, node: event.node }
      : null;
  }
  return null;
};

export interface EventProjection {
  readonly shell: ShellSnapshot;
  readonly threads: Readonly<Record<string, ThreadDetail>>;
  readonly checkpoints: Readonly<Record<string, ReadonlyArray<CheckpointProjectionRecord>>>;
  readonly settings: UserSettings | null;
}

export const emptyEventProjection = (): EventProjection => ({
  shell: { projects: [], threads: [], latestSequence: 0 },
  threads: {},
  checkpoints: {},
  settings: null,
});

const upsertById = <A extends { readonly id: string }>(
  values: ReadonlyArray<A>,
  value: A,
): ReadonlyArray<A> => [...values.filter((candidate) => candidate.id !== value.id), value];

const sortedProjects = (projects: ReadonlyArray<Project>): ReadonlyArray<Project> =>
  projects.toSorted(
    (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
  );

const sortedThreads = (threads: ReadonlyArray<Thread>): ReadonlyArray<Thread> =>
  threads.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const projectChildCounts = (nodes: ReadonlyArray<AgentNode>): ReadonlyArray<AgentNode> => {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId !== null) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
  }
  return nodes.map((node) => ({ ...node, childCount: counts.get(node.id) ?? 0 }));
};

const updateThreadDetail = (
  projection: EventProjection,
  threadId: ThreadId,
  update: (detail: ThreadDetail) => ThreadDetail,
): EventProjection => {
  const detail = projection.threads[threadId];
  if (detail === undefined) return projection;
  return { ...projection, threads: { ...projection.threads, [threadId]: update(detail) } };
};

const advance = (projection: EventProjection, sequence: Sequence): EventProjection => ({
  ...projection,
  shell: { ...projection.shell, latestSequence: sequence },
});

export const projectDomainEvent = (
  current: EventProjection,
  event: DomainEvent,
): EventProjection => {
  if (event.sequence <= current.shell.latestSequence) return current;
  let projection = advance(current, event.sequence);

  if (event.type === "project.upserted") {
    return {
      ...projection,
      shell: {
        ...projection.shell,
        projects: sortedProjects(upsertById(projection.shell.projects, event.project)),
      },
    };
  }
  if (event.type === "project.removed") {
    const threadIds = new Set<string>(
      projection.shell.threads
        .filter((thread) => thread.projectId === event.projectId)
        .map((thread) => thread.id),
    );
    return {
      ...projection,
      shell: {
        ...projection.shell,
        projects: projection.shell.projects.filter((project) => project.id !== event.projectId),
        threads: projection.shell.threads.filter((thread) => !threadIds.has(thread.id)),
      },
      threads: Object.fromEntries(
        Object.entries(projection.threads).filter(([threadId]) => !threadIds.has(threadId)),
      ),
      checkpoints: Object.fromEntries(
        Object.entries(projection.checkpoints).filter(([threadId]) => !threadIds.has(threadId)),
      ),
    };
  }
  if (event.type === "thread.upserted") {
    const existing = projection.threads[event.thread.id];
    const detail: ThreadDetail =
      existing === undefined
        ? {
            thread: event.thread,
            messages: [],
            toolCalls: [],
            interactions: [],
            agentNodes: [],
            latestSequence: event.sequence,
          }
        : { ...existing, thread: event.thread, latestSequence: event.sequence };
    return {
      ...projection,
      shell: {
        ...projection.shell,
        threads: sortedThreads(upsertById(projection.shell.threads, event.thread)),
      },
      threads: { ...projection.threads, [event.thread.id]: detail },
    };
  }
  if (event.type === "thread.status-changed") {
    const update = (thread: Thread): Thread =>
      thread.id === event.threadId
        ? { ...thread, status: event.status, updatedAt: event.updatedAt }
        : thread;
    projection = {
      ...projection,
      shell: { ...projection.shell, threads: sortedThreads(projection.shell.threads.map(update)) },
    };
    return updateThreadDetail(projection, event.threadId, (detail) => ({
      ...detail,
      thread: update(detail.thread),
      latestSequence: event.sequence,
    }));
  }
  if (event.type === "thread.removed") {
    return {
      ...projection,
      shell: {
        ...projection.shell,
        threads: projection.shell.threads.filter((thread) => thread.id !== event.threadId),
      },
      threads: Object.fromEntries(
        Object.entries(projection.threads).filter(([threadId]) => threadId !== event.threadId),
      ),
      checkpoints: Object.fromEntries(
        Object.entries(projection.checkpoints).filter(([threadId]) => threadId !== event.threadId),
      ),
    };
  }
  if (event.type === "message.upserted") {
    return updateThreadDetail(projection, event.message.threadId, (detail) => {
      const existing = detail.messages.find((message) => message.id === event.message.id);
      return {
        ...detail,
        messages: upsertById(detail.messages, {
          ...event.message,
          sequence: existing?.sequence ?? event.sequence,
        }).toSorted((left, right) => left.sequence - right.sequence),
        latestSequence: event.sequence,
      };
    });
  }
  if (event.type === "tool.upserted") {
    return updateThreadDetail(projection, event.toolCall.threadId, (detail) => {
      const existing = detail.toolCalls.find((toolCall) => toolCall.id === event.toolCall.id);
      return {
        ...detail,
        toolCalls: upsertById(detail.toolCalls, {
          ...event.toolCall,
          sequence: existing?.sequence ?? event.sequence,
        }),
        latestSequence: event.sequence,
      };
    });
  }
  if (event.type === "interaction.upserted") {
    return updateThreadDetail(projection, event.interaction.threadId, (detail) => {
      const existing = detail.interactions.find(
        (interaction) => interaction.id === event.interaction.id,
      );
      return {
        ...detail,
        interactions: upsertById(detail.interactions, {
          ...event.interaction,
          sequence: existing?.sequence ?? event.sequence,
        }),
        latestSequence: event.sequence,
      };
    });
  }
  if (event.type === "agent-node.upserted") {
    return updateThreadDetail(projection, event.node.threadId, (detail) => ({
      ...detail,
      agentNodes: projectChildCounts(upsertById(detail.agentNodes, event.node)),
      latestSequence: event.sequence,
    }));
  }
  if (event.type === "checkpoint.saved") {
    const existing = projection.checkpoints[event.record.threadId] ?? [];
    return {
      ...projection,
      checkpoints: {
        ...projection.checkpoints,
        [event.record.threadId]: [
          ...existing.filter((record) => record.checkpoint.id !== event.record.checkpoint.id),
          event.record,
        ].toSorted((left, right) =>
          left.checkpoint.createdAt.localeCompare(right.checkpoint.createdAt),
        ),
      },
    };
  }
  if (event.type === "settings.saved") {
    return { ...projection, settings: event.settings };
  }
  return updateThreadDetail(projection, event.threadId, (detail) => ({
    ...detail,
    latestSequence: event.sequence,
  }));
};

import type { ServerEvent, ShellSnapshot, ThreadDetail } from "@metaclanker/contracts/wire";

export interface LiveThreadState {
  readonly shell: ShellSnapshot;
  readonly detail: ThreadDetail;
}

const upsertById = <A extends { readonly id: string }>(
  values: ReadonlyArray<A>,
  value: A,
): ReadonlyArray<A> => [...values.filter((candidate) => candidate.id !== value.id), value];

const advance = (state: LiveThreadState, sequence: number): LiveThreadState => ({
  shell: state.shell,
  detail: { ...state.detail, latestSequence: sequence },
});

/** Pure, cursor-aware reduction for replayed and live thread events. */
export const applyThreadEvent = (state: LiveThreadState, event: ServerEvent): LiveThreadState => {
  if (event.type === "snapshot-required") return state;
  if (event.sequence <= state.detail.latestSequence) return state;
  const next = advance(state, event.sequence);
  if (event.type === "synchronized") return next;
  if (event.type === "project-upserted" || event.type === "project-removed") return next;
  if (event.type === "thread-upserted") {
    return {
      shell: {
        ...next.shell,
        threads: upsertById(next.shell.threads, event.thread).toSorted((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      },
      detail: { ...next.detail, thread: event.thread },
    };
  }
  if (event.type === "thread-status") {
    return {
      shell: {
        ...next.shell,
        threads: next.shell.threads.map((thread) =>
          thread.id === event.threadId ? { ...thread, status: event.status } : thread,
        ),
      },
      detail: { ...next.detail, thread: { ...next.detail.thread, status: event.status } },
    };
  }
  if (event.type === "thread-removed") return next;
  if (event.type === "message-upserted") {
    const existing = next.detail.messages.find((message) => message.id === event.message.id);
    return {
      ...next,
      detail: {
        ...next.detail,
        messages: upsertById(next.detail.messages, {
          ...event.message,
          sequence: existing?.sequence ?? event.message.sequence,
        }).toSorted((left, right) => left.sequence - right.sequence),
      },
    };
  }
  if (event.type === "tool-upserted") {
    const existing = next.detail.toolCalls.find((toolCall) => toolCall.id === event.toolCall.id);
    return {
      ...next,
      detail: {
        ...next.detail,
        toolCalls: upsertById(next.detail.toolCalls, {
          ...event.toolCall,
          sequence: existing?.sequence ?? event.toolCall.sequence,
        }),
      },
    };
  }
  if (event.type === "interaction-upserted") {
    const existing = next.detail.interactions.find(
      (interaction) => interaction.id === event.interaction.id,
    );
    return {
      ...next,
      detail: {
        ...next.detail,
        interactions: upsertById(next.detail.interactions, {
          ...event.interaction,
          sequence: existing?.sequence ?? event.interaction.sequence,
        }),
      },
    };
  }
  return {
    ...next,
    detail: {
      ...next.detail,
      agentNodes: upsertById(next.detail.agentNodes, event.node),
    },
  };
};

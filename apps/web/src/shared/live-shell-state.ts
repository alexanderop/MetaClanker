import type { ServerEvent, ShellSnapshot } from "@metaclanker/contracts/wire";

const upsertById = <A extends { readonly id: string }>(
  values: ReadonlyArray<A>,
  value: A,
): ReadonlyArray<A> => [...values.filter((candidate) => candidate.id !== value.id), value];

const sortProjects = (shell: ShellSnapshot["projects"]): ShellSnapshot["projects"] =>
  shell.toSorted(
    (left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt),
  );

const sortThreads = (shell: ShellSnapshot["threads"]): ShellSnapshot["threads"] =>
  shell.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

/** Pure, idempotent reduction for the global project/thread journal cursor. */
export const applyShellEvent = (shell: ShellSnapshot, event: ServerEvent): ShellSnapshot => {
  if (event.type === "snapshot-required") return shell;
  if (event.sequence <= shell.latestSequence) return shell;
  const advanced = { ...shell, latestSequence: event.sequence };
  if (event.type === "synchronized") return advanced;
  if (event.type === "project-upserted") {
    return {
      ...advanced,
      projects: sortProjects(upsertById(advanced.projects, event.project)),
    };
  }
  if (event.type === "project-removed") {
    return {
      ...advanced,
      projects: advanced.projects.filter((project) => project.id !== event.projectId),
      threads: advanced.threads.filter((thread) => thread.projectId !== event.projectId),
    };
  }
  if (event.type === "thread-upserted") {
    return {
      ...advanced,
      threads: sortThreads(upsertById(advanced.threads, event.thread)),
    };
  }
  if (event.type === "thread-removed") {
    return {
      ...advanced,
      threads: advanced.threads.filter((thread) => thread.id !== event.threadId),
    };
  }
  if (event.type === "thread-status") {
    return {
      ...advanced,
      threads: advanced.threads.map((thread) =>
        thread.id === event.threadId ? { ...thread, status: event.status } : thread,
      ),
    };
  }
  return advanced;
};

import { ServerEvent } from "@metaclanker/contracts/wire";
import type { ShellSnapshot } from "@metaclanker/contracts/wire";

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

/**
 * Pure, idempotent reduction for the global project/thread journal cursor. Dispatching
 * through the union's own matcher is what keeps this exhaustive: a new frame type fails
 * to compile here instead of falling through the chain unhandled.
 */
export const applyShellEvent = (
  shell: ShellSnapshot,
  event: typeof ServerEvent.Type,
): ShellSnapshot => {
  if (event.type === "snapshot-required") return shell;
  if (event.sequence <= shell.latestSequence) return shell;
  const advanced = { ...shell, latestSequence: event.sequence };
  return ServerEvent.match(event, {
    "snapshot-required": () => shell,
    synchronized: () => advanced,
    "project-upserted": (frame) => ({
      ...advanced,
      projects: sortProjects(upsertById(advanced.projects, frame.project)),
    }),
    "project-removed": (frame) => ({
      ...advanced,
      projects: advanced.projects.filter((project) => project.id !== frame.projectId),
      threads: advanced.threads.filter((thread) => thread.projectId !== frame.projectId),
    }),
    "thread-upserted": (frame) => ({
      ...advanced,
      threads: sortThreads(upsertById(advanced.threads, frame.thread)),
    }),
    "thread-removed": (frame) => ({
      ...advanced,
      threads: advanced.threads.filter((thread) => thread.id !== frame.threadId),
    }),
    "thread-status": (frame) => ({
      ...advanced,
      threads: advanced.threads.map((thread) =>
        thread.id === frame.threadId ? { ...thread, status: frame.status } : thread,
      ),
    }),
    "message-upserted": () => advanced,
    "tool-upserted": () => advanced,
    "interaction-upserted": () => advanced,
    "agent-node-upserted": () => advanced,
  });
};

import { Context, Effect, FiberSet, Layer } from "effect";

import type { AcpSessionHandle } from "@metaclanker/application/ports";
import type { ThreadId } from "@metaclanker/contracts/ids";

export interface TurnSupervisorService {
  /** Starts one runtime-owned worker for an admitted root-thread operation. */
  readonly submit: (threadId: ThreadId, task: Effect.Effect<void, never>) => Effect.Effect<void>;
  /** Waits for every worker accepted before this call to finish. */
  readonly drain: Effect.Effect<void>;
  readonly session: (threadId: ThreadId) => AcpSessionHandle | undefined;
  readonly opening: (threadId: ThreadId) => Promise<AcpSessionHandle> | undefined;
  /** Registers an opening unless the server runtime is already shutting down. */
  readonly registerOpening: (threadId: ThreadId, opening: Promise<AcpSessionHandle>) => boolean;
  readonly clearOpening: (threadId: ThreadId, opening: Promise<AcpSessionHandle>) => void;
  /** Registers a live session unless the server runtime is already shutting down. */
  readonly registerSession: (threadId: ThreadId, session: AcpSessionHandle) => boolean;
  readonly takeSession: (threadId: ThreadId) => AcpSessionHandle | undefined;
  readonly startTurn: (threadId: ThreadId) => void;
  readonly finishTurn: (threadId: ThreadId) => void;
  readonly hasActiveTurn: (threadId: ThreadId) => boolean;
  /** Closes all sessions owned by this runtime and prevents new ownership. */
  readonly closeAll: Effect.Effect<void>;
}

export class TurnSupervisor extends Context.Service<TurnSupervisor, TurnSupervisorService>()(
  "@metaclanker/server/TurnSupervisor",
) {}

export const turnSupervisorLayer = Layer.effect(
  TurnSupervisor,
  Effect.gen(function* () {
    const sessions = new Map<ThreadId, AcpSessionHandle>();
    const openings = new Map<ThreadId, Promise<AcpSessionHandle>>();
    const activeTurns = new Set<ThreadId>();
    const workers = new Set<ThreadId>();
    const fibers = yield* FiberSet.make<void, never>();
    let closed = false;

    const closeAll = Effect.suspend(() => {
      closed = true;
      const pendingOpenings = [...openings.values()];
      openings.clear();
      return Effect.promise(() => Promise.allSettled(pendingOpenings)).pipe(
        Effect.andThen(() => {
          const activeSessions = [...sessions.values()];
          sessions.clear();
          activeTurns.clear();
          return Effect.forEach(activeSessions, (session) => session.close, { discard: true });
        }),
      );
    });

    yield* Effect.addFinalizer(() => closeAll);
    return {
      submit: (threadId, task) =>
        Effect.suspend(() => {
          if (closed || workers.has(threadId)) return Effect.void;
          workers.add(threadId);
          return FiberSet.run(
            fibers,
            task.pipe(Effect.ensuring(Effect.sync(() => workers.delete(threadId)))),
          ).pipe(Effect.asVoid);
        }),
      drain: FiberSet.awaitEmpty(fibers),
      session: (threadId) => sessions.get(threadId),
      opening: (threadId) => openings.get(threadId),
      registerOpening: (threadId, opening) => {
        if (closed) return false;
        openings.set(threadId, opening);
        return true;
      },
      clearOpening: (threadId, opening) => {
        if (openings.get(threadId) === opening) openings.delete(threadId);
      },
      registerSession: (threadId, session) => {
        if (closed) return false;
        sessions.set(threadId, session);
        return true;
      },
      takeSession: (threadId) => {
        const session = sessions.get(threadId);
        sessions.delete(threadId);
        return session;
      },
      startTurn: (threadId) => {
        activeTurns.add(threadId);
      },
      finishTurn: (threadId) => {
        activeTurns.delete(threadId);
      },
      hasActiveTurn: (threadId) => activeTurns.has(threadId),
      closeAll,
    } satisfies TurnSupervisorService;
  }),
);

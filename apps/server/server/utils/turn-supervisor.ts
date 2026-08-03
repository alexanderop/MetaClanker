import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type { AcpSessionHandle, NormalizedAgentEvent } from "@metaclanker/application/ports";
import type { ThreadId } from "@metaclanker/contracts/ids";

export interface TurnSupervisorService {
  /** Acquires a session resource in the supervisor layer's lifetime. */
  readonly acquire: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Scope.Scope>>;
  readonly attachSession: (threadId: ThreadId, session: AcpSessionHandle) => Effect.Effect<void>;
  readonly setEventHandler: (
    threadId: ThreadId,
    handler: ((event: NormalizedAgentEvent) => Effect.Effect<void, unknown>) | null,
  ) => void;
  /** Starts one runtime-owned worker for an admitted root-thread operation. */
  readonly submit: (threadId: ThreadId, task: Effect.Effect<void, never>) => Effect.Effect<void>;
  /** Waits for every worker accepted before this call to finish. */
  readonly drain: Effect.Effect<void>;
  readonly session: (threadId: ThreadId) => AcpSessionHandle | undefined;
  /** Remembers whether the last provider generation had a deterministic rollover boundary. */
  readonly continuationSafety: (threadId: ThreadId) => "safe" | "unsafe" | undefined;
  /** Registers a live session unless the server runtime is already shutting down. */
  readonly registerSession: (threadId: ThreadId, session: AcpSessionHandle) => boolean;
  readonly takeSession: (threadId: ThreadId) => AcpSessionHandle | undefined;
  readonly drainSessionEvents: (
    threadId: ThreadId,
    session: AcpSessionHandle,
  ) => Effect.Effect<void, unknown>;
  readonly retireSession: (
    threadId: ThreadId,
    session: AcpSessionHandle,
  ) => Effect.Effect<void, unknown>;
  readonly evictSession: (threadId: ThreadId) => Effect.Effect<void>;
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
    const continuationSafety = new Map<ThreadId, "safe" | "unsafe">();
    const activeTurns = new Set<ThreadId>();
    const workers = new Set<ThreadId>();
    const fibers = yield* FiberSet.make<void, never>();
    const scope = yield* Effect.scope;
    const eventHandlers = new Map<
      ThreadId,
      (event: NormalizedAgentEvent) => Effect.Effect<void, unknown>
    >();
    const eventCompletions = new Map<ThreadId, Deferred.Deferred<void, unknown>>();
    let closed = false;

    const closeAll = Effect.suspend(() => {
      closed = true;
      const activeSessions = [...sessions.values()];
      const completions = [...eventCompletions.values()];
      sessions.clear();
      continuationSafety.clear();
      eventHandlers.clear();
      eventCompletions.clear();
      activeTurns.clear();
      return FiberSet.clear(fibers).pipe(
        Effect.andThen(
          Effect.forEach(activeSessions, (session) => session.abort, { discard: true }),
        ),
        Effect.andThen(
          Effect.forEach(completions, (completion) => Deferred.await(completion), {
            concurrency: "unbounded",
            discard: true,
          }).pipe(Effect.catch(() => Effect.void)),
        ),
      );
    });

    yield* Effect.addFinalizer(() => closeAll);
    return {
      acquire: (effect) => Scope.provide(scope)(effect),
      attachSession: (threadId, session) =>
        Effect.gen(function* () {
          const completion = yield* Deferred.make<void, unknown>();
          eventCompletions.set(threadId, completion);
          yield* Scope.provide(scope)(
            session.events.pipe(
              Stream.runForEach((event) =>
                Effect.suspend(() => eventHandlers.get(threadId)?.(event) ?? Effect.void),
              ),
              Effect.exit,
              Effect.flatMap((exit) =>
                Effect.gen(function* () {
                  if (Exit.isFailure(exit)) {
                    const failure = Cause.squash(exit.cause);
                    if (sessions.get(threadId) === session) {
                      sessions.delete(threadId);
                      eventHandlers.delete(threadId);
                    }
                    yield* Deferred.fail(completion, failure);
                    yield* session.abort;
                    yield* Effect.logWarning("ACP session event stream failed");
                    return;
                  }
                  yield* Deferred.succeed(completion, undefined);
                }),
              ),
              Effect.forkScoped,
              Effect.asVoid,
            ),
          );
        }),
      setEventHandler: (threadId, handler) => {
        if (handler === null) eventHandlers.delete(threadId);
        else eventHandlers.set(threadId, handler);
      },
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
      continuationSafety: (threadId) => continuationSafety.get(threadId),
      registerSession: (threadId, session) => {
        if (closed) return false;
        sessions.set(threadId, session);
        continuationSafety.set(
          threadId,
          session.capabilities.close && (session.capabilities.resume || session.capabilities.load)
            ? "safe"
            : "unsafe",
        );
        return true;
      },
      takeSession: (threadId) => {
        const session = sessions.get(threadId);
        sessions.delete(threadId);
        eventHandlers.delete(threadId);
        return session;
      },
      drainSessionEvents: (threadId, session) => {
        const completion = eventCompletions.get(threadId);
        if (completion === undefined || sessions.get(threadId) !== session) {
          return Effect.fail(new Error("ACP session is no longer active"));
        }
        return Effect.raceFirst(session.drainAcceptedEvents, Deferred.await(completion));
      },
      retireSession: (threadId, session) => {
        const completion = eventCompletions.get(threadId);
        if (completion === undefined || sessions.get(threadId) !== session) return Effect.void;
        return session.close.pipe(
          Effect.andThen(Deferred.await(completion)),
          Effect.ensuring(
            Effect.sync(() => {
              if (sessions.get(threadId) === session) sessions.delete(threadId);
              if (eventCompletions.get(threadId) === completion) {
                eventCompletions.delete(threadId);
              }
              eventHandlers.delete(threadId);
            }),
          ),
        );
      },
      evictSession: (threadId) => {
        const session = sessions.get(threadId);
        const completion = eventCompletions.get(threadId);
        sessions.delete(threadId);
        eventCompletions.delete(threadId);
        eventHandlers.delete(threadId);
        if (session === undefined) return Effect.void;
        return session.abort.pipe(
          Effect.andThen(
            completion === undefined
              ? Effect.void
              : Deferred.await(completion).pipe(Effect.catch(() => Effect.void)),
          ),
        );
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

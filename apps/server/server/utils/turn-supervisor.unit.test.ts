import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe } from "vitest";

import { AcpRuntimeError, type AcpSessionHandle } from "@metaclanker/application/ports";
import { ThreadId } from "@metaclanker/contracts/ids";

import { TurnSupervisor, turnSupervisorLayer } from "./turn-supervisor.js";

const testSession = (
  onClose: () => void,
  events: AcpSessionHandle["events"] = Stream.empty,
  drainAcceptedEvents: AcpSessionHandle["drainAcceptedEvents"] = Effect.void,
  abort: AcpSessionHandle["abort"] = Effect.sync(onClose),
): AcpSessionHandle => ({
  providerSessionId: "provider-session",
  capabilities: {
    protocolVersion: 1,
    resume: true,
    load: true,
    close: true,
    delete: false,
    graph: "available",
    models: [],
    modes: [],
  },
  events,
  drainAcceptedEvents,
  prompt: () => Effect.succeed({ stopReason: "completed" }),
  requestCancel: () => Effect.void,
  respondInteraction: () => Effect.void,
  close: Effect.sync(onClose),
  abort,
});

describe("TurnSupervisor", () => {
  it.effect("owns per-thread worker fibers and drains them without a generic queue", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const runs = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const supervisor = yield* TurnSupervisor;
        const threadId = ThreadId.make("thread:worker");
        const worker = Ref.update(runs, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(started, undefined)),
          Effect.andThen(Deferred.await(release)),
        );
        yield* supervisor.submit(threadId, worker);
        yield* supervisor.submit(
          threadId,
          Ref.update(runs, (count) => count + 1),
        );
        yield* Deferred.await(started);
        expect(yield* Ref.get(runs)).toBe(1);
        yield* Deferred.succeed(release, undefined);
        yield* supervisor.drain;
      }).pipe(Effect.provide(turnSupervisorLayer));
    }),
  );

  it.effect("interrupts an in-flight thread worker when the runtime closes", () =>
    Effect.gen(function* () {
      const runtime = ManagedRuntime.make(turnSupervisorLayer);
      const interrupted = yield* Deferred.make<void>();
      yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const supervisor = yield* TurnSupervisor;
            yield* supervisor.submit(
              ThreadId.make("thread:interrupted"),
              Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
            );
          }),
        ),
      );
      yield* Effect.promise(() => runtime.dispose());
      expect(yield* Deferred.isDone(interrupted)).toBe(true);
    }),
  );

  it.effect("closes runtime-owned sessions and rejects new ownership during shutdown", () =>
    Effect.gen(function* () {
      const runtime = ManagedRuntime.make(turnSupervisorLayer);
      const threadId = ThreadId.make("thread-1");
      let closed = 0;

      const accepted = yield* Effect.promise(() =>
        runtime.runPromise(
          Effect.gen(function* () {
            const supervisor = yield* TurnSupervisor;
            expect(
              supervisor.registerSession(
                threadId,
                testSession(() => closed++),
              ),
            ).toBe(true);
            yield* supervisor.closeAll;
            return supervisor.registerSession(
              threadId,
              testSession(() => closed++),
            );
          }),
        ),
      );

      expect(closed).toBe(1);
      expect(accepted).toBe(false);
      yield* Effect.promise(() => runtime.dispose());
      expect(closed).toBe(1);
    }),
  );

  it.effect("evicts an idle session when its event stream disconnects", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const aborted = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const supervisor = yield* TurnSupervisor;
        const threadId = ThreadId.make("thread:idle-disconnect");
        const events = Stream.fromEffect(Deferred.await(release)).pipe(
          Stream.flatMap(() =>
            Stream.fail(
              new AcpRuntimeError({ code: "disconnected", message: "idle adapter exited" }),
            ),
          ),
        );
        const session = testSession(
          () => undefined,
          events,
          Effect.void,
          Deferred.succeed(aborted, undefined),
        );
        expect(supervisor.registerSession(threadId, session)).toBe(true);
        yield* supervisor.attachSession(threadId, session);
        yield* Deferred.succeed(release, undefined);
        yield* Deferred.await(aborted);
        expect(supervisor.session(threadId)).toBeUndefined();
        expect(supervisor.continuationSafety(threadId)).toBe("safe");
      }).pipe(Effect.provide(turnSupervisorLayer));
    }),
  );

  it.effect("retains an unsafe continuation marker after an idle disconnect", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>();
      const aborted = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const supervisor = yield* TurnSupervisor;
        const threadId = ThreadId.make("thread:unsafe-idle-disconnect");
        const events = Stream.fromEffect(Deferred.await(release)).pipe(
          Stream.flatMap(() =>
            Stream.fail(
              new AcpRuntimeError({ code: "disconnected", message: "idle adapter exited" }),
            ),
          ),
        );
        const base = testSession(
          () => undefined,
          events,
          Effect.void,
          Deferred.succeed(aborted, undefined),
        );
        const session: AcpSessionHandle = {
          ...base,
          capabilities: { ...base.capabilities, resume: false, load: false, close: false },
        };
        expect(supervisor.registerSession(threadId, session)).toBe(true);
        yield* supervisor.attachSession(threadId, session);
        yield* Deferred.succeed(release, undefined);
        yield* Deferred.await(aborted);
        expect(supervisor.session(threadId)).toBeUndefined();
        expect(supervisor.continuationSafety(threadId)).toBe("unsafe");
      }).pipe(Effect.provide(turnSupervisorLayer));
    }),
  );

  it.effect("fails the turn drain when durable event handling fails", () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const supervisor = yield* TurnSupervisor;
        const threadId = ThreadId.make("thread:event-persistence-failure");
        const session = testSession(
          () => undefined,
          Stream.make({ type: "agent-message-chunk", chunk: "must persist" }),
          Effect.never,
        );
        supervisor.setEventHandler(threadId, () => Effect.fail(new Error("database unavailable")));
        expect(supervisor.registerSession(threadId, session)).toBe(true);
        yield* supervisor.attachSession(threadId, session);
        const failure = yield* supervisor.drainSessionEvents(threadId, session).pipe(Effect.flip);
        expect(failure).toBeInstanceOf(Error);
        expect(supervisor.session(threadId)).toBeUndefined();
      }).pipe(Effect.provide(turnSupervisorLayer));
    }),
  );
});

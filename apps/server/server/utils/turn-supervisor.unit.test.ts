import { expect, it } from "@effect/vitest";
import { Deferred, Effect, ManagedRuntime, Ref } from "effect";
import { describe } from "vitest";

import type { AcpSessionHandle } from "@metaclanker/application/ports";
import { ThreadId } from "@metaclanker/contracts/ids";

import { TurnSupervisor, turnSupervisorLayer } from "./turn-supervisor.js";

const testSession = (onClose: () => void): AcpSessionHandle => ({
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
  prompt: () => Effect.succeed({ stopReason: "completed" }),
  requestCancel: () => Effect.void,
  respondInteraction: () => Effect.void,
  close: Effect.sync(onClose),
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
});

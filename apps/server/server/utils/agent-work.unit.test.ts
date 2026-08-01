import { Deferred, Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";

import { AgentWork, agentWorkLayer } from "./agent-work.js";

describe("AgentWork", () => {
  it("drains accepted work through the owned runtime", async () => {
    const runtime = ManagedRuntime.make(agentWorkLayer);
    const completed = await Effect.runPromise(Deferred.make<void>());

    await runtime.runPromise(
      Effect.gen(function* () {
        const work = yield* AgentWork;
        yield* work.submit(Deferred.succeed(completed, undefined));
        yield* work.drain;
      }),
    );

    expect(await Effect.runPromise(Deferred.isDone(completed))).toBe(true);
    await runtime.dispose();
  });

  it("interrupts in-flight work when its runtime closes", async () => {
    const runtime = ManagedRuntime.make(agentWorkLayer);
    const interrupted = await Effect.runPromise(Deferred.make<void>());

    await runtime.runPromise(
      Effect.gen(function* () {
        const work = yield* AgentWork;
        yield* work.submit(
          Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
        );
      }),
    );
    await runtime.dispose();

    expect(await Effect.runPromise(Deferred.isDone(interrupted))).toBe(true);
  });
});

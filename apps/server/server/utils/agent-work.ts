import { Context, Effect, FiberSet, Layer } from "effect";

export interface AgentWorkService {
  /** Starts runtime-owned work. Closing the runtime interrupts every submitted task. */
  readonly submit: (task: Effect.Effect<void, never>) => Effect.Effect<void>;
  /** Waits until all work accepted before this call has completed. */
  readonly drain: Effect.Effect<void>;
}

export class AgentWork extends Context.Tag("@metaclanker/server/AgentWork")<
  AgentWork,
  AgentWorkService
>() {}

export const agentWorkLayer = Layer.scoped(
  AgentWork,
  Effect.gen(function* () {
    const fibers = yield* FiberSet.make<void, never>();
    return {
      submit: (task) => FiberSet.run(fibers, task).pipe(Effect.asVoid),
      drain: FiberSet.awaitEmpty(fibers),
    } satisfies AgentWorkService;
  }),
);

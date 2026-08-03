import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

export type ThreadSubscriber = (event: ServerEvent) => void;
export type ShellSubscriber = (event: ServerEvent) => void;

const publish = <Subscriber extends (event: ServerEvent) => void>(
  subscribers: Iterable<Subscriber>,
  event: ServerEvent,
  remove: (subscriber: Subscriber) => void,
): Effect.Effect<void> =>
  Effect.forEach(
    subscribers,
    (subscriber) =>
      Effect.try({
        try: () => subscriber(event),
        catch: () => "subscriber-failure" as const,
      }).pipe(Effect.catch(() => Effect.sync(() => remove(subscriber)))),
    { discard: true },
  );

export interface EventFanoutService {
  readonly publishShell: (event: ServerEvent) => Effect.Effect<void>;
  readonly subscribeShell: (subscriber: ShellSubscriber) => () => void;
  readonly publishThread: (threadId: ThreadId, event: ServerEvent) => Effect.Effect<void>;
  readonly subscribeThread: (threadId: ThreadId, subscriber: ThreadSubscriber) => () => void;
}

export class EventFanout extends Context.Service<EventFanout, EventFanoutService>()(
  "@metaclanker/server/EventFanout",
) {}

/** Runtime-scoped committed-event fanout. Peer buffering stays with each WebSocket peer. */
export const eventFanoutLayer = Layer.effect(
  EventFanout,
  Effect.gen(function* () {
    const threadSubscribers = new Map<ThreadId, Set<ThreadSubscriber>>();
    const shellSubscribers = new Set<ShellSubscriber>();

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        threadSubscribers.clear();
        shellSubscribers.clear();
      }),
    );

    return {
      publishShell: (event) =>
        publish(shellSubscribers, event, (subscriber) => shellSubscribers.delete(subscriber)),
      subscribeShell: (subscriber) => {
        shellSubscribers.add(subscriber);
        return () => shellSubscribers.delete(subscriber);
      },
      publishThread: (threadId, event) => {
        const subscribers = threadSubscribers.get(threadId);
        if (subscribers === undefined) return Effect.void;
        return publish(subscribers, event, (subscriber) => subscribers.delete(subscriber)).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (subscribers.size === 0) threadSubscribers.delete(threadId);
            }),
          ),
        );
      },
      subscribeThread: (threadId, subscriber) => {
        const subscribers = threadSubscribers.get(threadId) ?? new Set<ThreadSubscriber>();
        subscribers.add(subscriber);
        threadSubscribers.set(threadId, subscribers);
        return () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) threadSubscribers.delete(threadId);
        };
      },
    } satisfies EventFanoutService;
  }),
);

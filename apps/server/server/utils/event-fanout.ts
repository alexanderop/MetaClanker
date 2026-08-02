import { Context, Effect, Layer } from "effect";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

export type ThreadSubscriber = (event: ServerEvent) => void;
export type ShellSubscriber = (event: ServerEvent) => void;

const publish = <Subscriber extends (event: ServerEvent) => void>(
  subscribers: Iterable<Subscriber>,
  event: ServerEvent,
  remove: (subscriber: Subscriber) => void,
): void => {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      remove(subscriber);
    }
  }
};

export interface EventFanoutService {
  readonly publishShell: (event: ServerEvent) => void;
  readonly subscribeShell: (subscriber: ShellSubscriber) => () => void;
  readonly publishThread: (threadId: ThreadId, event: ServerEvent) => void;
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
        if (subscribers === undefined) return;
        publish(subscribers, event, (subscriber) => subscribers.delete(subscriber));
        if (subscribers.size === 0) threadSubscribers.delete(threadId);
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

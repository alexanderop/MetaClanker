import type { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

export type ThreadSubscriber = (event: ServerEvent) => void;

const subscribers = new Map<string, Set<ThreadSubscriber>>();

export const publishThreadEvent = (threadId: ThreadId, event: ServerEvent): void => {
  for (const subscriber of subscribers.get(threadId) ?? []) {
    subscriber(event);
  }
};

export const subscribeToThread = (threadId: string, subscriber: ThreadSubscriber): (() => void) => {
  const threadSubscribers = subscribers.get(threadId) ?? new Set<ThreadSubscriber>();
  threadSubscribers.add(subscriber);
  subscribers.set(threadId, threadSubscribers);
  return () => {
    threadSubscribers.delete(subscriber);
    if (threadSubscribers.size === 0) subscribers.delete(threadId);
  };
};

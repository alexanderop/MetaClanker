import * as Effect from "effect/Effect";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

import { EventFanout, type ShellSubscriber, type ThreadSubscriber } from "./event-fanout.js";
import { runApplication } from "./runtime.js";

export type { ShellSubscriber, ThreadSubscriber } from "./event-fanout.js";

/** Publishes an already-committed event; shutdown only drops this best-effort wake-up. */
export const publishShellEvent = async (event: ServerEvent): Promise<void> => {
  await runApplication(
    Effect.gen(function* () {
      const fanout = yield* EventFanout;
      yield* fanout.publishShell(event);
    }),
  ).catch(() => undefined);
};

export const subscribeToShell = async (subscriber: ShellSubscriber): Promise<() => void> =>
  await runApplication(
    Effect.gen(function* () {
      const fanout = yield* EventFanout;
      return fanout.subscribeShell(subscriber);
    }),
  );

/** Publishes an already-committed event; shutdown only drops this best-effort wake-up. */
export const publishThreadEvent = async (threadId: ThreadId, event: ServerEvent): Promise<void> => {
  await runApplication(
    Effect.gen(function* () {
      const fanout = yield* EventFanout;
      yield* fanout.publishThread(threadId, event);
    }),
  ).catch(() => undefined);
};

export const subscribeToThread = async (
  threadId: ThreadId,
  subscriber: ThreadSubscriber,
): Promise<() => void> =>
  await runApplication(
    Effect.gen(function* () {
      const fanout = yield* EventFanout;
      return fanout.subscribeThread(threadId, subscriber);
    }),
  );

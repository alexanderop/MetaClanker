import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, vi } from "vitest";

import { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

import { EventFanout, eventFanoutLayer } from "./event-fanout.js";

const event: ServerEvent = {
  type: "thread-status",
  sequence: 1,
  threadId: ThreadId.make("thread:hub"),
  status: "running",
};

describe("event fanout", () => {
  it.layer(eventFanoutLayer)("with a runtime-scoped fanout", (layerIt) => {
    layerIt.effect("isolates a throwing shell subscriber from healthy peers", () =>
      Effect.gen(function* () {
        const fanout = yield* EventFanout;
        const healthy = vi.fn();
        const removeBroken = fanout.subscribeShell(() => {
          throw new Error("socket closed");
        });
        const removeHealthy = fanout.subscribeShell(healthy);

        fanout.publishShell(event);
        expect(healthy).toHaveBeenCalledWith(event);

        removeBroken();
        removeHealthy();
      }),
    );

    layerIt.effect("isolates a throwing thread subscriber from healthy peers", () =>
      Effect.gen(function* () {
        const fanout = yield* EventFanout;
        const healthy = vi.fn();
        const removeBroken = fanout.subscribeThread(event.threadId, () => {
          throw new Error("socket closed");
        });
        const removeHealthy = fanout.subscribeThread(event.threadId, healthy);

        fanout.publishThread(event.threadId, event);
        expect(healthy).toHaveBeenCalledWith(event);

        removeBroken();
        removeHealthy();
      }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

import { createReplaySocketState } from "./replay-socket-state.js";

const statusEvent = (sequence: number): ServerEvent => ({
  type: "thread-status",
  sequence,
  threadId: ThreadId.make("thread:replay-buffer"),
  status: "running",
});

describe("bounded replay socket state", () => {
  it("stops accepting events when the overlap buffer reaches its bound", () => {
    const send = vi.fn();
    const overflow = vi.fn();
    const state = createReplaySocketState({ send, overflow, bufferLimit: 2 });

    state.push(statusEvent(1));
    state.push(statusEvent(2));
    state.push(statusEvent(3));
    state.push(statusEvent(4));

    expect(overflow).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(state.synchronize(0, new Set())).toBe(false);
  });

  it("drains overlap in sequence order and then forwards live events", () => {
    const sent: ServerEvent[] = [];
    const state = createReplaySocketState({
      send: (event) => sent.push(event),
      overflow: vi.fn(),
      bufferLimit: 4,
    });

    state.push(statusEvent(5));
    state.push(statusEvent(3));
    state.push(statusEvent(4));

    expect(state.synchronize(3, new Set([4]))).toBe(true);
    state.push(statusEvent(6));

    expect(sent.map((event) => ("sequence" in event ? event.sequence : 0))).toEqual([5, 6]);
  });
});

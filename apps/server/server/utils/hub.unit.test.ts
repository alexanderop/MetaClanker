import { describe, expect, it, vi } from "vitest";

import { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

import {
  publishShellEvent,
  publishThreadEvent,
  subscribeToShell,
  subscribeToThread,
} from "./hub.js";

const event: ServerEvent = {
  type: "thread-status",
  sequence: 1,
  threadId: ThreadId.make("thread:hub"),
  status: "running",
};

describe("event hub", () => {
  it("isolates a throwing shell subscriber from healthy peers", () => {
    const healthy = vi.fn();
    const removeBroken = subscribeToShell(() => {
      throw new Error("socket closed");
    });
    const removeHealthy = subscribeToShell(healthy);

    expect(() => publishShellEvent(event)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(event);

    removeBroken();
    removeHealthy();
  });

  it("isolates a throwing thread subscriber from healthy peers", () => {
    const healthy = vi.fn();
    const removeBroken = subscribeToThread(event.threadId, () => {
      throw new Error("socket closed");
    });
    const removeHealthy = subscribeToThread(event.threadId, healthy);

    expect(() => publishThreadEvent(event.threadId, event)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(event);

    removeBroken();
    removeHealthy();
  });
});

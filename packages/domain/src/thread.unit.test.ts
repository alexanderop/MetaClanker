import { describe, expect, it } from "vitest";

import { initialThreadRuntimeState, transitionThread } from "./thread.js";

describe("thread runtime transitions", () => {
  it("marks a disconnected active turn as requiring explicit recovery", () => {
    const running = transitionThread(initialThreadRuntimeState, {
      type: "start",
      turnId: "turn-1",
    });
    const disconnected = transitionThread(running, { type: "disconnect" });

    expect(disconnected).toEqual({
      status: "recovery-required",
      activeTurnId: null,
      cancelRequested: false,
      disconnected: true,
    });
  });

  it("does not claim cancellation until the prompt settles", () => {
    const running = transitionThread(initialThreadRuntimeState, {
      type: "start",
      turnId: "turn-1",
    });
    const cancelling = transitionThread(running, { type: "request-cancel" });

    expect(cancelling.status).toBe("cancelling");
    expect(transitionThread(cancelling, { type: "settle", outcome: "cancelled" }).status).toBe(
      "cancelled",
    );
  });
});

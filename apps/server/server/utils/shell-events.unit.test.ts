import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThreadId } from "@metaclanker/contracts/ids";
import type { ServerEvent } from "@metaclanker/contracts/wire";

const mocks = vi.hoisted(() => ({
  runApplication: vi.fn(),
  subscribeToShell: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("./auth.js", () => ({ consumeWebSocketTicket: () => true }));
vi.mock("./event-replay.js", () => ({ readEventReplay: vi.fn() }));
vi.mock("./runtime.js", () => ({ runApplication: mocks.runApplication }));
vi.mock("./hub.js", () => ({ subscribeToShell: mocks.subscribeToShell }));

import handler from "../routes/api/shell/events.js";

const websocketHandler = handler as unknown as {
  readonly __websocket__: { readonly open: (peer: unknown) => void };
};

const statusEvent = (sequence: number): ServerEvent => ({
  type: "thread-status",
  sequence,
  threadId: ThreadId.make("thread:socket-route"),
  status: "running",
});

const peer = (id: string) => ({
  id,
  request: { url: "http://localhost/api/shell/events?ticket=test&afterSequence=0" },
  send: vi.fn(),
  close: vi.fn(),
});

describe("shell replay WebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscribeToShell.mockReturnValue(mocks.unsubscribe);
  });

  it("unsubscribes and closes when replay fails", async () => {
    const replay = Promise.reject(new Error("journal unavailable"));
    mocks.runApplication.mockReturnValue(replay);
    const socket = peer("peer:failed-replay");

    websocketHandler.__websocket__.open(socket);
    await replay.catch(() => undefined);
    await Promise.resolve();

    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "snapshot-required", reason: "replay-failed" }),
    );
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledWith(4409, "Fresh snapshot required");
  });

  it("unsubscribes and closes instead of buffering beyond the overlap bound", () => {
    mocks.runApplication.mockReturnValue(new Promise(() => undefined));
    let subscriber: ((event: ServerEvent) => void) | undefined;
    mocks.subscribeToShell.mockImplementation((candidate: (event: ServerEvent) => void) => {
      subscriber = candidate;
      return mocks.unsubscribe;
    });
    const socket = peer("peer:overflowed-replay");

    websocketHandler.__websocket__.open(socket);
    for (let sequence = 1; sequence <= 513; sequence += 1) subscriber?.(statusEvent(sequence));

    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "snapshot-required", reason: "buffer-overflow" }),
    );
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledWith(4409, "Fresh snapshot required");
  });
});

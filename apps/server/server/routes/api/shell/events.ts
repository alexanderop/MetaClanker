import { defineWebSocketHandler } from "h3";

import { Sequence } from "@metaclanker/contracts/ids";
import { domainEventToShellEvent } from "@metaclanker/domain/events";

import { consumeWebSocketTicket } from "../../../utils/auth.js";
import { readEventReplay } from "../../../utils/event-replay.js";
import { subscribeToShell } from "../../../utils/hub.js";
import { createReplaySocketState } from "../../../utils/replay-socket-state.js";
import { runApplication } from "../../../utils/runtime.js";

const noop = (): void => undefined;
const cleanupContextKey = "metaclankerShellEventsCleanup";
const peerCleanup = (peer: {
  readonly context: Record<string, unknown>;
}): (() => void) | undefined => {
  const cleanup = peer.context[cleanupContextKey];
  return typeof cleanup === "function" ? (cleanup as () => void) : undefined;
};

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.request.url, "http://localhost");
    if (!consumeWebSocketTicket(url.searchParams.get("ticket"))) {
      peer.close(4401, "Authentication required");
      return;
    }
    const requestedSequence = Number(url.searchParams.get("afterSequence") ?? "0");
    if (!Number.isSafeInteger(requestedSequence) || requestedSequence < 0) {
      peer.close(4400, "Invalid event cursor");
      return;
    }
    let active = true;
    let unsubscribe = noop;
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      replayState.stop();
      unsubscribe();
      delete peer.context[cleanupContextKey];
    };
    const requireSnapshot = (reason: "buffer-overflow" | "cursor-too-old" | "replay-failed") => {
      if (!active) return;
      peer.send(JSON.stringify({ type: "snapshot-required", reason }));
      cleanup();
      peer.close(4409, "Fresh snapshot required");
    };
    const replayState = createReplaySocketState({
      send: (event) => {
        if (active) peer.send(JSON.stringify(event));
      },
      overflow: () => requireSnapshot("buffer-overflow"),
    });
    unsubscribe = subscribeToShell(replayState.push);
    peer.context[cleanupContextKey] = cleanup;

    void runApplication(readEventReplay(Sequence.make(requestedSequence), domainEventToShellEvent))
      .then((replay) => {
        const replayed = new Set<number>();
        for (const event of replay.events) {
          replayed.add(event.sequence);
          if (active) peer.send(JSON.stringify(event));
        }
        if (!replay.complete) {
          requireSnapshot("cursor-too-old");
          return;
        }
        if (replayState.synchronize(replay.cursor, replayed) && active) {
          peer.send(JSON.stringify({ type: "synchronized", sequence: replay.cursor }));
        }
      })
      .catch(() => {
        requireSnapshot("replay-failed");
      });
  },
  message(peer, message) {
    if (message.text() === "ping") peer.send("pong");
  },
  close(peer) {
    peerCleanup(peer)?.();
  },
  error(peer) {
    peerCleanup(peer)?.();
  },
});

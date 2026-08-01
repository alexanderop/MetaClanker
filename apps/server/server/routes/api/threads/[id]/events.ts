import { defineWebSocketHandler } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";

import { consumeWebSocketTicket } from "../../../../utils/auth.js";
import { subscribeToThread } from "../../../../utils/hub.js";

const cleanups = new Map<string, () => void>();

const threadIdFromUrl = (url: string): ThreadId | null => {
  const parsed = new URL(url, "http://localhost");
  const match = /^\/api\/threads\/([^/]+)\/events$/u.exec(parsed.pathname);
  return match?.[1] === undefined ? null : ThreadId.make(decodeURIComponent(match[1]));
};

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.request.url, "http://localhost");
    const threadId = threadIdFromUrl(url.pathname);
    if (threadId === null || !consumeWebSocketTicket(url.searchParams.get("ticket"))) {
      peer.close(4401, "Authentication required");
      return;
    }
    cleanups.set(
      peer.id,
      subscribeToThread(threadId, (event) => {
        peer.send(JSON.stringify(event));
      }),
    );
    peer.send(JSON.stringify({ type: "snapshot-required", reason: "subscription-opened" }));
  },
  message(peer, message) {
    if (message.text() === "ping") peer.send("pong");
  },
  close(peer) {
    cleanups.get(peer.id)?.();
    cleanups.delete(peer.id);
  },
  error(peer) {
    cleanups.get(peer.id)?.();
    cleanups.delete(peer.id);
  },
});

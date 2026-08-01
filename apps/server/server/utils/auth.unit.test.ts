import { describe, expect, it } from "vitest";

import {
  consumeWebSocketTicket,
  createEnvironmentSession,
  isLoopbackRequest,
  issueWebSocketTicket,
  pairingHint,
  revokeEnvironmentSession,
  validateEnvironmentSession,
  verifyPairingCode,
} from "./auth.js";

describe("environment authentication", () => {
  it("uses Nitro's forwarded peer only across the local dev-worker boundary", () => {
    expect(isLoopbackRequest(undefined, "127.0.0.1", "worker-1")).toBe(true);
    expect(isLoopbackRequest(undefined, "::ffff:127.0.0.1", "worker-1")).toBe(true);
    expect(isLoopbackRequest(undefined, "192.0.2.1", "worker-1")).toBe(false);
    expect(isLoopbackRequest(undefined, "127.0.0.1", undefined)).toBe(false);
    expect(isLoopbackRequest("192.0.2.1", "127.0.0.1", "worker-1")).toBe(false);
  });

  it("revokes an environment session explicitly", () => {
    const session = createEnvironmentSession();
    expect(validateEnvironmentSession(session)).toBe(true);

    revokeEnvironmentSession(session);

    expect(validateEnvironmentSession(session)).toBe(false);
  });

  it("consumes WebSocket tickets at most once", () => {
    const ticket = issueWebSocketTicket();
    expect(consumeWebSocketTicket(ticket)).toBe(true);
    expect(consumeWebSocketTicket(ticket)).toBe(false);
  });

  it("accepts only the configured pairing secret", () => {
    expect(verifyPairingCode(pairingHint())).toBe(true);
    expect(verifyPairingCode(`${pairingHint()}-invalid`)).toBe(false);
  });
});

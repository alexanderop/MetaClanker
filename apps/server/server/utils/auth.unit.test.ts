import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe } from "vitest";

import {
  consumeWebSocketTicket,
  createEnvironmentSession,
  authenticationLayer,
  isLoopbackRequest,
  isTrustedLocalBootstrap,
  issueWebSocketTicket,
  pairingHint,
  revokeEnvironmentSession,
  sessionCookieOptions,
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

  it("rejects reverse-proxied and DNS-rebound local bootstrap requests", () => {
    expect(isLoopbackRequest("127.0.0.1", "203.0.113.8", undefined)).toBe(false);
    expect(
      isTrustedLocalBootstrap({
        address: "127.0.0.1",
        forwardedAddress: "127.0.0.1",
        nitroDevWorkerId: undefined,
        host: "attacker.example",
        origin: "https://attacker.example",
      }),
    ).toBe(false);
    expect(
      isTrustedLocalBootstrap({
        address: "127.0.0.1",
        forwardedAddress: "127.0.0.1",
        nitroDevWorkerId: undefined,
        host: "127.0.0.1:4317",
        origin: "http://127.0.0.1:4317",
      }),
    ).toBe(true);
  });

  it.layer(authenticationLayer({ pairingCode: "configured-test-code" }))(
    "with runtime-scoped authentication state",
    (layerIt) => {
      layerIt.effect("revokes an environment session explicitly", () =>
        Effect.gen(function* () {
          const session = yield* createEnvironmentSession;
          expect(yield* validateEnvironmentSession(session)).toBe(true);
          yield* revokeEnvironmentSession(session);
          expect(yield* validateEnvironmentSession(session)).toBe(false);
        }),
      );

      layerIt.effect("consumes WebSocket tickets at most once", () =>
        Effect.gen(function* () {
          const ticket = yield* issueWebSocketTicket;
          expect(yield* consumeWebSocketTicket(ticket)).toBe(true);
          expect(yield* consumeWebSocketTicket(ticket)).toBe(false);
        }),
      );

      layerIt.effect("accepts only the configured pairing secret", () =>
        Effect.gen(function* () {
          const hint = yield* pairingHint;
          expect(yield* verifyPairingCode(hint)).toBe(true);
          expect(yield* verifyPairingCode(`${hint}-invalid`)).toBe(false);
        }),
      );
    },
  );

  it("uses one session lifetime and changes the Secure attribute only for HTTPS", () => {
    expect(sessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    expect(sessionCookieOptions(true)).toMatchObject({ secure: true });
  });
});

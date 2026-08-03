import { randomBytes, timingSafeEqual } from "node:crypto";

import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const TICKET_TTL_MS = 30_000;
const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1_000;

interface ExpiringToken {
  readonly expiresAt: number;
}

const token = (): string => randomBytes(32).toString("base64url");

const isLoopbackAddress = (address: string): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

export const isLoopbackRequest = (
  address: string | undefined,
  forwardedAddress: string | undefined,
  nitroDevWorkerId: string | undefined,
): boolean => {
  if (address !== undefined) {
    if (!isLoopbackAddress(address)) return false;
    return forwardedAddress === undefined || isLoopbackAddress(forwardedAddress);
  }
  return nitroDevWorkerId !== undefined && forwardedAddress !== undefined
    ? isLoopbackAddress(forwardedAddress)
    : false;
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const hostnameFromHost = (host: string | undefined): string | null => {
  const value = host === undefined ? undefined : `http://${host}`;
  if (value === undefined || !URL.canParse(value)) return null;
  return new URL(value).hostname;
};

export const isTrustedLocalBootstrap = (input: {
  readonly address: string | undefined;
  readonly forwardedAddress: string | undefined;
  readonly nitroDevWorkerId: string | undefined;
  readonly host: string | undefined;
  readonly origin: string | undefined;
}): boolean => {
  if (!isLoopbackRequest(input.address, input.forwardedAddress, input.nitroDevWorkerId)) {
    return false;
  }
  const hostname = hostnameFromHost(input.host);
  if (hostname === null || !isLoopbackHostname(hostname)) return false;
  if (input.origin === undefined) return true;
  if (!URL.canParse(input.origin)) return false;
  return isLoopbackHostname(new URL(input.origin).hostname);
};

const equal = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const prune = (store: Map<string, ExpiringToken>, now: number): void => {
  for (const [key, value] of store) {
    if (value.expiresAt <= now) store.delete(key);
  }
};

export interface AuthenticationService {
  readonly createEnvironmentSession: () => Effect.Effect<string>;
  readonly validateEnvironmentSession: (value: string | undefined) => Effect.Effect<boolean>;
  readonly revokeEnvironmentSession: (value: string) => Effect.Effect<void>;
  readonly verifyPairingCode: (value: string) => Effect.Effect<boolean>;
  readonly issueWebSocketTicket: () => Effect.Effect<string>;
  readonly consumeWebSocketTicket: (value: string | null) => Effect.Effect<boolean>;
  readonly pairingHint: Effect.Effect<string>;
}

export class Authentication extends Context.Service<Authentication, AuthenticationService>()(
  "@metaclanker/server/Authentication",
) {}

export interface AuthenticationLayerOptions {
  readonly pairingCode?: string;
}

export const authenticationLayer = (options: AuthenticationLayerOptions = {}) =>
  Layer.effect(
    Authentication,
    Effect.gen(function* () {
      const configuredCode =
        options.pairingCode ??
        Option.getOrElse(
          yield* Config.option(Config.nonEmptyString("METACLANKER_PAIRING_CODE")),
          () => randomBytes(6).toString("base64url"),
        );
      const sessions = new Map<string, ExpiringToken>();
      const tickets = new Map<string, ExpiringToken>();
      return {
        createEnvironmentSession: Effect.fn("Authentication.createEnvironmentSession")(
          function* () {
            const now = yield* Clock.currentTimeMillis;
            prune(sessions, now);
            const value = token();
            sessions.set(value, { expiresAt: now + SESSION_TTL_MS });
            return value;
          },
        ),
        validateEnvironmentSession: Effect.fn("Authentication.validateEnvironmentSession")(
          function* (value: string | undefined) {
            if (value === undefined) return false;
            const now = yield* Clock.currentTimeMillis;
            prune(sessions, now);
            return sessions.has(value);
          },
        ),
        revokeEnvironmentSession: Effect.fn("Authentication.revokeEnvironmentSession")((value) =>
          Effect.sync(() => sessions.delete(value)).pipe(Effect.asVoid),
        ),
        verifyPairingCode: Effect.fn("Authentication.verifyPairingCode")((value) =>
          Effect.sync(() => equal(value, configuredCode)),
        ),
        issueWebSocketTicket: Effect.fn("Authentication.issueWebSocketTicket")(function* () {
          const now = yield* Clock.currentTimeMillis;
          prune(tickets, now);
          const value = token();
          tickets.set(value, { expiresAt: now + TICKET_TTL_MS });
          return value;
        }),
        consumeWebSocketTicket: Effect.fn("Authentication.consumeWebSocketTicket")(function* (
          value: string | null,
        ) {
          if (value === null) return false;
          const now = yield* Clock.currentTimeMillis;
          prune(tickets, now);
          const valid = tickets.has(value);
          tickets.delete(value);
          return valid;
        }),
        pairingHint: Effect.succeed(configuredCode),
      } satisfies AuthenticationService;
    }),
  );

export const createEnvironmentSession = Effect.flatMap(Authentication, (service) =>
  service.createEnvironmentSession(),
);
export const validateEnvironmentSession = (value: string | undefined) =>
  Effect.flatMap(Authentication, (service) => service.validateEnvironmentSession(value));
export const revokeEnvironmentSession = (value: string) =>
  Effect.flatMap(Authentication, (service) => service.revokeEnvironmentSession(value));
export const verifyPairingCode = (value: string) =>
  Effect.flatMap(Authentication, (service) => service.verifyPairingCode(value));
export const issueWebSocketTicket = Effect.flatMap(Authentication, (service) =>
  service.issueWebSocketTicket(),
);
export const consumeWebSocketTicket = (value: string | null) =>
  Effect.flatMap(Authentication, (service) => service.consumeWebSocketTicket(value));
export const pairingHint = Effect.flatMap(Authentication, (service) => service.pairingHint);

export const sessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
});

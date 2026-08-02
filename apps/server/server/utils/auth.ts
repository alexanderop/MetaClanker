import { randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const TICKET_TTL_MS = 30_000;
const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1_000;

interface ExpiringToken {
  readonly expiresAt: number;
}

const sessions = new Map<string, ExpiringToken>();
const tickets = new Map<string, ExpiringToken>();
let generatedPairingCode: string | undefined;

const configuredPairingCode = (): string => {
  const configured = process.env["METACLANKER_PAIRING_CODE"];
  if (configured !== undefined) return configured;
  generatedPairingCode ??= randomBytes(6).toString("base64url");
  return generatedPairingCode;
};

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
  if (host === undefined) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
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
  try {
    return isLoopbackHostname(new URL(input.origin).hostname);
  } catch {
    return false;
  }
};

const equal = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const prune = (store: Map<string, ExpiringToken>) => {
  const now = Date.now();
  for (const [key, value] of store) {
    if (value.expiresAt <= now) store.delete(key);
  }
};

export const createEnvironmentSession = (): string => {
  prune(sessions);
  const value = token();
  sessions.set(value, { expiresAt: Date.now() + SESSION_TTL_MS });
  return value;
};

export const validateEnvironmentSession = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  prune(sessions);
  return sessions.has(value);
};

export const revokeEnvironmentSession = (value: string): void => {
  sessions.delete(value);
};

export const verifyPairingCode = (value: string): boolean => equal(value, configuredPairingCode());

export const issueWebSocketTicket = (): string => {
  prune(tickets);
  const value = token();
  tickets.set(value, { expiresAt: Date.now() + TICKET_TTL_MS });
  return value;
};

export const consumeWebSocketTicket = (value: string | null): boolean => {
  if (value === null) return false;
  prune(tickets);
  const valid = tickets.has(value);
  tickets.delete(value);
  return valid;
};

export const pairingHint = (): string => configuredPairingCode();

export const sessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
});

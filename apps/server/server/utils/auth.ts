import { randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const TICKET_TTL_MS = 30_000;

interface ExpiringToken {
  readonly expiresAt: number;
}

const sessions = new Map<string, ExpiringToken>();
const tickets = new Map<string, ExpiringToken>();
const pairingCode = process.env["METACLANKER_PAIRING_CODE"] ?? randomBytes(6).toString("base64url");

const token = (): string => randomBytes(32).toString("base64url");

const isLoopbackAddress = (address: string): boolean =>
  address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

export const isLoopbackRequest = (
  address: string | undefined,
  forwardedAddress: string | undefined,
  nitroDevWorkerId: string | undefined,
): boolean => {
  if (address !== undefined) return isLoopbackAddress(address);
  return nitroDevWorkerId !== undefined && forwardedAddress !== undefined
    ? isLoopbackAddress(forwardedAddress)
    : false;
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

export const verifyPairingCode = (value: string): boolean => equal(value, pairingCode);

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

export const pairingHint = (): string => pairingCode;

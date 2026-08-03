import { send, setHeader, setResponseStatus, type H3Error, type H3Event } from "h3";
import { defineNitroErrorHandler } from "nitropack/runtime/error";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ErrorCode, type ErrorCode as PublicErrorCode } from "@metaclanker/contracts/wire";

const errorCodeForStatus = (statusCode: number): PublicErrorCode => {
  if (statusCode === 400) return "invalid-request";
  if (statusCode === 401) return "unauthenticated";
  if (statusCode === 403) return "forbidden";
  if (statusCode === 404) return "not-found";
  if (statusCode === 409) return "conflict";
  if (statusCode === 422) return "invalid-request";
  return "internal";
};

const publicCode = (error: H3Error): PublicErrorCode => {
  const data = error.data;
  if (typeof data === "object" && data !== null && "code" in data) {
    const decoded = Schema.decodeUnknownOption(ErrorCode)(data.code);
    if (Option.isSome(decoded)) return decoded.value;
  }
  return errorCodeForStatus(error.statusCode);
};

const isH3Error = (cause: unknown): cause is H3Error =>
  typeof cause === "object" &&
  cause !== null &&
  "statusCode" in cause &&
  typeof cause.statusCode === "number" &&
  "message" in cause &&
  typeof cause.message === "string";

// Nitro v2's generated error-handler declaration is unavailable before the first server build.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineNitroErrorHandler((cause: unknown, event: H3Event) => {
  const error = isH3Error(cause) ? cause : null;
  const statusCode =
    error !== null && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  const safeMessage = statusCode >= 500 ? "Operation failed" : (error?.message ?? "Request failed");
  setResponseStatus(event, statusCode);
  setHeader(event, "content-type", "application/json; charset=utf-8");
  setHeader(event, "cache-control", "no-store");
  return send(
    event,
    JSON.stringify({
      error: {
        code: error === null ? "internal" : publicCode(error),
        message: safeMessage,
      },
    }),
  );
});

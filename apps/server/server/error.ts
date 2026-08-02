import { send, setHeader, setResponseStatus, type H3Error, type H3Event } from "h3";
import { defineNitroErrorHandler } from "nitropack/runtime/error";

const errorCodeForStatus = (statusCode: number): string => {
  if (statusCode === 400) return "invalid-request";
  if (statusCode === 401) return "unauthenticated";
  if (statusCode === 403) return "forbidden";
  if (statusCode === 404) return "not-found";
  if (statusCode === 409) return "conflict";
  if (statusCode === 422) return "invalid-request";
  return "internal";
};

const publicCode = (error: H3Error): string => {
  const data = error.data;
  if (typeof data === "object" && data !== null && "code" in data) {
    const code = data.code;
    if (typeof code === "string") return code;
  }
  return errorCodeForStatus(error.statusCode);
};

// Nitro v2's generated error-handler declaration is unavailable before the first server build.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineNitroErrorHandler((cause: unknown, event: H3Event) => {
  const error = cause as H3Error;
  const statusCode = error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  const safeMessage = statusCode >= 500 ? "Operation failed" : error.message || "Request failed";
  setResponseStatus(event, statusCode);
  setHeader(event, "content-type", "application/json; charset=utf-8");
  setHeader(event, "cache-control", "no-store");
  return send(event, JSON.stringify({ error: { code: publicCode(error), message: safeMessage } }));
});

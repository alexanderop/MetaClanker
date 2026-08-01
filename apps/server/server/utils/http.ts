import { Schema } from "effect";
import { createError, type H3Event, readBody } from "h3";

export const decodeBody = async <A, I>(
  event: H3Event,
  schema: Schema.Schema<A, I, never>,
): Promise<A> => {
  const body: unknown = await readBody<unknown>(event);
  return Schema.decodeUnknownPromise(schema)(body).catch(() => {
    throw createError({ statusCode: 400, statusMessage: "Invalid request" });
  });
};

export const publicError = (cause: unknown) => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ProjectPathError"
  ) {
    const reason = "reason" in cause ? cause.reason : "not-readable";
    let message = "That server directory is not readable";
    if (reason === "not-absolute") message = "Enter an absolute server path";
    if (reason === "not-found") message = "That server path does not exist";
    if (reason === "not-directory") message = "That server path is not a directory";
    return createError({ statusCode: 422, statusMessage: message });
  }
  if (
    cause instanceof Error &&
    /^The (codex|claude) provider is unavailable$/u.test(cause.message)
  ) {
    return createError({ statusCode: 409, statusMessage: cause.message });
  }
  if (cause instanceof Error && cause.message === "Project not found") {
    return createError({ statusCode: 404, statusMessage: cause.message });
  }
  return createError({ statusCode: 500, statusMessage: "Operation failed" });
};

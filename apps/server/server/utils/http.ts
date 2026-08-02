import { Schema } from "effect";
import { createError, defineEventHandler, type H3Error, type H3Event, readBody } from "h3";

import type { ApplicationError } from "@metaclanker/application/commands";

const isApplicationError = (cause: unknown): cause is ApplicationError =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  cause._tag === "ApplicationError" &&
  "code" in cause &&
  typeof cause.code === "string" &&
  "message" in cause &&
  typeof cause.message === "string";

export const decodeBody = async <A>(
  event: H3Event,
  schema: Schema.ConstraintDecoder<A, never>,
): Promise<A> => {
  const body: unknown = await readBody<unknown>(event);
  return Schema.decodeUnknownPromise(schema)(body).catch(() => {
    throw createError({
      statusCode: 400,
      message: "Invalid request",
      data: { code: "invalid-request" },
    });
  });
};

const applicationPublicError = (cause: unknown) => {
  if (isApplicationError(cause)) {
    const statusCode = (() => {
      switch (cause.code) {
        case "invalid-request":
          return 400;
        case "provider-unavailable":
        case "conflict":
          return 409;
        case "not-found":
          return 404;
        case "invalid-project":
          return 422;
        case "persistence":
          return 500;
      }
    })();
    return createError({
      statusCode,
      message: cause.code === "persistence" ? "Operation failed" : cause.message,
      data: { code: cause.code },
    });
  }
  return undefined;
};

const projectPathPublicError = (cause: unknown) => {
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
    return createError({ statusCode: 422, message, data: { code: "invalid-project" } });
  }
  return undefined;
};

const isHttpError = (cause: unknown): cause is H3Error =>
  typeof cause === "object" &&
  cause !== null &&
  "statusCode" in cause &&
  typeof cause.statusCode === "number";

export const publicError = (cause: unknown) => {
  if (isHttpError(cause)) return cause;
  const application = applicationPublicError(cause);
  if (application !== undefined) return application;
  const projectPath = projectPathPublicError(cause);
  if (projectPath !== undefined) return projectPath;
  return createError({ statusCode: 500, message: "Operation failed", data: { code: "internal" } });
};

/** Every API handler has the same safe public-error boundary. */
export const defineApiHandler = <A>(handler: (event: H3Event) => A | Promise<A>) =>
  defineEventHandler(async (event) => {
    try {
      return await handler(event);
    } catch (cause) {
      throw publicError(cause);
    }
  });

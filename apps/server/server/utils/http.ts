import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  type H3Error,
  type H3Event,
  readBody,
} from "h3";

import { ApplicationError } from "@metaclanker/application/commands";
import { ProjectPathError } from "@metaclanker/application/ports";

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

export const decodeRouteParam = async <A>(
  event: H3Event,
  name: string,
  schema: Schema.ConstraintDecoder<A, never>,
): Promise<A> => {
  const value: unknown = getRouterParam(event, name);
  return Schema.decodeUnknownPromise(schema)(value).catch(() => {
    throw createError({
      statusCode: 400,
      message: `Invalid ${name} route parameter`,
      data: { code: "invalid-request" },
    });
  });
};

/** Encodes public output through the same shared contract consumed by clients. */
export const encodeResponse = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"],
): S["Encoded"] => Schema.encodeSync(schema)(value);

const applicationPublicError = (cause: unknown) => {
  const decoded = Schema.decodeUnknownOption(ApplicationError)(cause);
  if (Option.isSome(decoded)) {
    const error = decoded.value;
    const statusCode = (() => {
      switch (error.code) {
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
      message: error.code === "persistence" ? "Operation failed" : error.message,
      data: { code: error.code },
    });
  }
  return undefined;
};

const projectPathPublicError = (cause: unknown) => {
  const decoded = Schema.decodeUnknownOption(ProjectPathError)(cause);
  if (Option.isSome(decoded)) {
    const reason = decoded.value.reason;
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
  defineEventHandler((event) =>
    Effect.runPromise(
      Effect.tryPromise({
        try: async () => await handler(event),
        catch: publicError,
      }),
    ),
  );

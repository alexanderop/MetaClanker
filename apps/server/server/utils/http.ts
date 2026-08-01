import { Schema } from "effect";
import { createError, type H3Event, readBody } from "h3";

export const decodeBody = async <A, I>(
  event: H3Event,
  schema: Schema.Schema<A, I, never>,
): Promise<A> => {
  const body: unknown = await readBody<unknown>(event);
  return Schema.decodeUnknownPromise(schema)(body).catch((cause: unknown) => {
    throw createError({ statusCode: 400, statusMessage: "Invalid request", data: String(cause) });
  });
};

export const publicError = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return createError({ statusCode: 500, statusMessage: "Operation failed", data: message });
};

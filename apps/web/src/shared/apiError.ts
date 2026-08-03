import * as Schema from "effect/Schema";

/**
 * Safe API-boundary failure. It carries where the call failed and how, never what came
 * back: a `SchemaError` message embeds the value it rejected, so a malformed frame would
 * otherwise put prompt content, tool output, or absolute paths on screen.
 */
export class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  operation: Schema.String,
  kind: Schema.Literals(["network", "http", "invalid-json", "invalid-response"]),
  status: Schema.optionalKey(Schema.Number),
  /** Server-authored public text from `ErrorResponse`. Never a decoded response value. */
  detail: Schema.optionalKey(Schema.String),
}) {}

const isApiError = (cause: unknown): cause is ApiError =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  (cause as { readonly _tag: unknown })._tag === "ApiError";

/**
 * Renders a rejected API call for display. Anything that is not an `ApiError`, and any
 * `ApiError` without server-authored text, falls back rather than rendering the cause.
 */
export const apiErrorMessage = (cause: unknown, fallback: string): string =>
  isApiError(cause) && cause.detail !== undefined ? cause.detail : fallback;

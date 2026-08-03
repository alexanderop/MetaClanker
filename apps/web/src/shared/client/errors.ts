import * as Schema from "effect/Schema";

/** Safe client-boundary failure; it never retains response bodies or request payloads. */
export class ClientError extends Schema.TaggedErrorClass<ClientError>()("ClientError", {
  operation: Schema.String,
  kind: Schema.Literals(["network", "http", "invalid-json", "invalid-response"]),
  status: Schema.optionalKey(Schema.Number),
}) {}

export const clientErrorMessage = (error: ClientError): string => {
  const status = error.status === undefined ? "" : ` (HTTP ${error.status})`;
  switch (error.operation) {
    case "load review":
      return `Could not load review${status}.`;
    case "load restore preview":
      return `Could not load restore preview${status}.`;
    case "restore files":
      return `Could not restore files${status}. The server receipt should be checked before retrying.`;
    default:
      return `The request failed${status}.`;
  }
};

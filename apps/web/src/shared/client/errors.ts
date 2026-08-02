import * as Data from "effect/Data";

export type ClientErrorKind = "network" | "http" | "invalid-json" | "invalid-response";

/** Safe client-boundary failure; it never retains response bodies or request payloads. */
export class ClientError extends Data.TaggedError("ClientError")<{
  readonly operation: string;
  readonly kind: ClientErrorKind;
  readonly status?: number;
}> {}

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

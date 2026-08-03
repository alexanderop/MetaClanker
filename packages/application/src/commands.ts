import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Checkpoints, MetaClankerStore, ProjectFiles } from "./ports.js";
import type { ProjectPathError, StoreError } from "./ports.js";

export class Store extends Context.Service<Store, MetaClankerStore>()(
  "@metaclanker/application/Store",
) {}

export class Files extends Context.Service<Files, ProjectFiles>()(
  "@metaclanker/application/Files",
) {}

export class CheckpointService extends Context.Service<CheckpointService, Checkpoints>()(
  "@metaclanker/application/CheckpointService",
) {}

export class ApplicationError extends Schema.TaggedErrorClass<ApplicationError>()(
  "ApplicationError",
  {
    code: Schema.Literals([
      "invalid-project",
      "invalid-request",
      "provider-unavailable",
      "not-found",
      "conflict",
      "persistence",
    ]),
    message: Schema.String,
  },
) {}

/**
 * The operation only rides along on `"persistence"`, whose message the HTTP edge
 * replaces anyway. `"not-found"` and `"conflict"` reach the user verbatim.
 */
export const applicationErrorFromStore = (cause: StoreError): ApplicationError =>
  new ApplicationError({
    code: cause.code,
    message: cause.code === "persistence" ? `${cause.operation}: ${cause.message}` : cause.message,
  });

const projectPathMessage = (reason: ProjectPathError["reason"]): string => {
  if (reason === "not-absolute") return "Enter an absolute server path";
  if (reason === "not-found") return "That server path does not exist";
  if (reason === "not-directory") return "That server path is not a directory";
  return "That server directory is not readable";
};

export const applicationErrorFromProjectPath = (cause: ProjectPathError): ApplicationError =>
  new ApplicationError({ code: "invalid-project", message: projectPathMessage(cause.reason) });

export const mapStoreError = <A, R>(
  effect: Effect.Effect<A, StoreError, R>,
): Effect.Effect<A, ApplicationError, R> => Effect.mapError(effect, applicationErrorFromStore);

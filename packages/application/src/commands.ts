import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Checkpoints, MetaClankerStore, ProjectFiles } from "./ports.js";

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

export const mapStoreError = <A>(
  effect: Effect.Effect<
    A,
    { readonly code: "not-found" | "conflict" | "persistence"; readonly message: string }
  >,
) =>
  effect.pipe(
    Effect.mapError((error) => new ApplicationError({ code: error.code, message: error.message })),
  );

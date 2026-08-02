import { Context, Data, Effect } from "effect";

import type { Checkpoints, MetaClankerStore, ProjectFiles } from "./ports.js";

export class Store extends Context.Tag("@metaclanker/application/Store")<
  Store,
  MetaClankerStore
>() {}

export class Files extends Context.Tag("@metaclanker/application/Files")<Files, ProjectFiles>() {}

export class CheckpointService extends Context.Tag("@metaclanker/application/CheckpointService")<
  CheckpointService,
  Checkpoints
>() {}

export class ApplicationError extends Data.TaggedError("ApplicationError")<{
  readonly code:
    | "invalid-project"
    | "invalid-request"
    | "provider-unavailable"
    | "not-found"
    | "conflict"
    | "persistence";
  readonly message: string;
}> {}

export const mapStoreError = <A>(
  effect: Effect.Effect<
    A,
    { readonly code: "not-found" | "conflict" | "persistence"; readonly message: string }
  >,
) =>
  effect.pipe(
    Effect.mapError((error) => new ApplicationError({ code: error.code, message: error.message })),
  );

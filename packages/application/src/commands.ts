import { Context, Data, Effect } from "effect";

import type { MetaClankerStore, ProjectFiles } from "./ports.js";

export class Store extends Context.Tag("@metaclanker/application/Store")<
  Store,
  MetaClankerStore
>() {}

export class Files extends Context.Tag("@metaclanker/application/Files")<Files, ProjectFiles>() {}

export class ApplicationError extends Data.TaggedError("ApplicationError")<{
  readonly code: "invalid-project" | "not-found" | "conflict" | "persistence";
  readonly message: string;
}> {}

export const mapStoreError = <A>(effect: Effect.Effect<A, { readonly message: string }>) =>
  effect.pipe(
    Effect.mapError(
      (error) => new ApplicationError({ code: "persistence", message: error.message }),
    ),
  );

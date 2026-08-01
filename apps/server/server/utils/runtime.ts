import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Layer, ManagedRuntime } from "effect";
import type { Effect } from "effect";

import type { Files, Store } from "@metaclanker/application/commands";
import { checkpointsLayer, projectFilesLayer } from "@metaclanker/git/checkpoints";
import type { CheckpointsService } from "@metaclanker/git/checkpoints";
import { databaseLayer } from "@metaclanker/persistence/database";

const createRuntime = (dataDirectory: string) => {
  mkdirSync(join(dataDirectory, "checkpoints"), { recursive: true });
  return ManagedRuntime.make(
    Layer.mergeAll(
      databaseLayer(join(dataDirectory, "metaclanker.sqlite")),
      projectFilesLayer,
      checkpointsLayer(join(dataDirectory, "checkpoints")),
    ),
  );
};

export let applicationDataDirectory = resolve(process.env["METACLANKER_DATA_DIR"] ?? ".data");
let runtime = createRuntime(applicationDataDirectory);

export const runApplication = <A, E>(
  effect: Effect.Effect<A, E, Store | Files | CheckpointsService>,
): Promise<A> => runtime.runPromise(effect);

export const closeApplicationRuntime = (): Promise<void> => runtime.dispose();

/** Test-support-only lifecycle seam; production startup creates the runtime once. */
export const resetApplicationRuntimeForTest = async (dataDirectory: string): Promise<void> => {
  await runtime.dispose();
  applicationDataDirectory = resolve(dataDirectory);
  runtime = createRuntime(applicationDataDirectory);
};

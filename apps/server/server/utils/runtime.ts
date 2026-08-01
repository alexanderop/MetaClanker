import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Layer, ManagedRuntime } from "effect";
import type { Effect } from "effect";

import type { Files, Store } from "@metaclanker/application/commands";
import { checkpointsLayer, projectFilesLayer } from "@metaclanker/git/checkpoints";
import type { CheckpointsService } from "@metaclanker/git/checkpoints";
import { databaseLayer } from "@metaclanker/persistence/database";

const dataDirectory = resolve(process.env["METACLANKER_DATA_DIR"] ?? ".data");
mkdirSync(join(dataDirectory, "checkpoints"), { recursive: true });

const ApplicationLive = Layer.mergeAll(
  databaseLayer(join(dataDirectory, "metaclanker.sqlite")),
  projectFilesLayer,
  checkpointsLayer(join(dataDirectory, "checkpoints")),
);

const runtime = ManagedRuntime.make(ApplicationLive);

export const runApplication = <A, E>(
  effect: Effect.Effect<A, E, Store | Files | CheckpointsService>,
): Promise<A> => runtime.runPromise(effect);

export const closeApplicationRuntime = (): Promise<void> => runtime.dispose();

export const applicationDataDirectory = dataDirectory;

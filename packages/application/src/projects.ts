import * as Effect from "effect/Effect";

import type { ProjectId } from "@metaclanker/contracts/ids";

import {
  Files,
  Store,
  applicationErrorFromProjectPath,
  applicationErrorFromStore,
} from "./commands.js";
import type { CreateProjectRecord, ProjectPathError, StoreError } from "./ports.js";

/**
 * Widening happens once, here. Adding a port error breaks this build rather than
 * degrading a message at the HTTP edge, which used to duck-type `unknown`.
 */
const widenProjectError = Effect.catchTags({
  StoreError: (cause: StoreError) => Effect.fail(applicationErrorFromStore(cause)),
  ProjectPathError: (cause: ProjectPathError) =>
    Effect.fail(applicationErrorFromProjectPath(cause)),
});

export const createProject = Effect.fn("Projects.create")(function* (
  input: Omit<CreateProjectRecord, "gitBranch" | "gitStatus">,
) {
  const files = yield* Files;
  const store = yield* Store;
  const status = yield* files.validateProject(input.path);
  return yield* store.createProject({
    ...input,
    gitBranch: status.branch,
    gitStatus: status.status,
  });
}, widenProjectError);

export const updateProject = Effect.fn("Projects.update")(function* (
  id: ProjectId,
  input: {
    readonly name?: string | undefined;
    readonly hidden?: boolean | undefined;
    readonly order?: number | undefined;
  },
) {
  const store = yield* Store;
  return yield* store.updateProject(id, input);
}, widenProjectError);

export const removeProject = Effect.fn("Projects.remove")(function* (id: ProjectId) {
  const store = yield* Store;
  return yield* store.removeProject(id);
}, widenProjectError);

export const listProjects = Effect.fn("Projects.list")(function* () {
  const store = yield* Store;
  const snapshot = yield* store.shellSnapshot;
  return snapshot.projects;
}, widenProjectError);

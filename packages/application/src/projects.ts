import { Effect } from "effect";

import type { ProjectId } from "@metaclanker/contracts/ids";

import { Files, Store } from "./commands.js";
import type { CreateProjectRecord } from "./ports.js";

export const createProject = (input: Omit<CreateProjectRecord, "gitBranch" | "gitStatus">) =>
  Effect.gen(function* () {
    const files = yield* Files;
    const store = yield* Store;
    const status = yield* files.validateProject(input.path);
    return yield* store.createProject({
      ...input,
      gitBranch: status.branch,
      gitStatus: status.status,
    });
  });

export const updateProject = (
  id: ProjectId,
  input: {
    readonly name?: string | undefined;
    readonly hidden?: boolean | undefined;
    readonly order?: number | undefined;
  },
) =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.updateProject(id, input);
  });

export const removeProject = (id: ProjectId) =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.removeProject(id);
  });

export const listProjects = () =>
  Effect.gen(function* () {
    const store = yield* Store;
    const snapshot = yield* store.shellSnapshot;
    return snapshot.projects;
  });

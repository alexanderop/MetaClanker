import * as Effect from "effect/Effect";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { UserSettings } from "@metaclanker/contracts/wire";

import { Store, applicationErrorFromStore } from "./commands.js";
import type { StoreError } from "./ports.js";

const widenWorkspaceError = Effect.catchTags({
  StoreError: (cause: StoreError) => Effect.fail(applicationErrorFromStore(cause)),
});

export const shellSnapshot = Effect.fn("Workspace.shellSnapshot")(function* () {
  const store = yield* Store;
  return yield* store.shellSnapshot;
}, widenWorkspaceError);

export const getSettings = Effect.fn("Workspace.getSettings")(function* () {
  const store = yield* Store;
  return yield* store.getSettings;
}, widenWorkspaceError);

export const saveSettings = Effect.fn("Workspace.saveSettings")(function* (settings: UserSettings) {
  const store = yield* Store;
  return yield* store.saveSettings(settings);
}, widenWorkspaceError);

export const getThread = Effect.fn("Workspace.getThread")(function* (id: ThreadId) {
  const store = yield* Store;
  return yield* store.getThread(id);
}, widenWorkspaceError);

export const deleteThread = Effect.fn("Workspace.deleteThread")(function* (id: ThreadId) {
  const store = yield* Store;
  return yield* store.deleteThread(id);
}, widenWorkspaceError);

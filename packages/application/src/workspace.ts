import { Effect } from "effect";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { UserSettings } from "@metaclanker/contracts/wire";

import { Store } from "./commands.js";

export const shellSnapshot = () =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.shellSnapshot;
  });

export const getSettings = () =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.getSettings;
  });

export const saveSettings = (settings: UserSettings) =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.saveSettings(settings);
  });

export const getThread = (id: ThreadId) =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.getThread(id);
  });

export const deleteThread = (id: ThreadId) =>
  Effect.gen(function* () {
    const store = yield* Store;
    return yield* store.deleteThread(id);
  });

import * as Effect from "effect/Effect";

import type { CheckpointId, ThreadId } from "@metaclanker/contracts/ids";
import type { PersistedCheckpointWire } from "@metaclanker/contracts/wire";

import type { PersistedCheckpoint } from "./ports.js";

import { ApplicationError, CheckpointService, Store } from "./commands.js";

const storeError = (cause: unknown): ApplicationError | undefined => {
  if (typeof cause !== "object" || cause === null || !("code" in cause) || !("message" in cause)) {
    return undefined;
  }
  const { code, message } = cause;
  if (
    (code !== "not-found" && code !== "conflict" && code !== "persistence") ||
    typeof message !== "string"
  ) {
    return undefined;
  }
  return new ApplicationError({ code, message });
};

const mapReviewError = (cause: unknown): ApplicationError => {
  const store = storeError(cause);
  if (store !== undefined) return store;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "CheckpointNotFound"
  ) {
    return new ApplicationError({ code: "not-found", message: "Checkpoint not found" });
  }
  return new ApplicationError({ code: "persistence", message: "Checkpoint operation failed" });
};

/** Removes filesystem-only checkpoint implementation details at the transport boundary. */
export const toPersistedCheckpointWire = (
  record: PersistedCheckpoint,
): PersistedCheckpointWire => ({
  checkpoint: {
    id: record.checkpoint.id,
    createdAt: record.checkpoint.createdAt,
    files: record.checkpoint.files,
  },
  threadId: record.threadId,
  turnId: record.turnId,
  kind: record.kind,
});

export const reviewThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const checkpoints = yield* CheckpointService;
    const records = yield* store.listCheckpoints(threadId);
    const post = records.toReversed().find((record) => record.kind === "post-turn");
    const pre = records
      .toReversed()
      .find((record) => record.kind === "pre-turn" && record.turnId === post?.turnId);
    const publicRecords = records.map(toPersistedCheckpointWire);
    if (pre === undefined || post === undefined)
      return { checkpoints: publicRecords, diff: { files: [] } };
    return {
      checkpoints: publicRecords,
      diff: yield* checkpoints.diff(pre.checkpoint, post.checkpoint),
    };
  }).pipe(Effect.mapError(mapReviewError));

export const previewFileRestore = (threadId: ThreadId, checkpointId: CheckpointId) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const checkpoints = yield* CheckpointService;
    const records = yield* store.listCheckpoints(threadId);
    const record = records.find((candidate) => candidate.checkpoint.id === checkpointId);
    if (record === undefined) return yield* Effect.fail({ _tag: "CheckpointNotFound" as const });
    return yield* checkpoints.previewRestore(record.checkpoint);
  }).pipe(Effect.mapError(mapReviewError));

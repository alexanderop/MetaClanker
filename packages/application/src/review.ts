import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CheckpointId, ThreadId } from "@metaclanker/contracts/ids";
import type { PersistedCheckpointWire } from "@metaclanker/contracts/wire";

import type { CheckpointError, PersistedCheckpoint, StoreError } from "./ports.js";

import {
  ApplicationError,
  CheckpointService,
  Store,
  applicationErrorFromStore,
} from "./commands.js";

class CheckpointNotFound extends Schema.TaggedErrorClass<CheckpointNotFound>()(
  "CheckpointNotFound",
  {},
) {}

/**
 * The one widening site for this module. A new port error becomes a compile error here
 * rather than a generic message at runtime, and the checkpoint operation survives.
 */
const widenReviewError = Effect.catchTags({
  StoreError: (cause: StoreError) => Effect.fail(applicationErrorFromStore(cause)),
  CheckpointError: (cause: CheckpointError) =>
    Effect.fail(
      new ApplicationError({
        code: "persistence",
        message: `Checkpoint ${cause.operation} failed: ${cause.message}`,
      }),
    ),
  CheckpointNotFound: () =>
    Effect.fail(new ApplicationError({ code: "not-found", message: "Checkpoint not found" })),
});

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

export const reviewThread = Effect.fn("Review.reviewThread")(function* (threadId: ThreadId) {
  const store = yield* Store;
  const checkpoints = yield* CheckpointService;
  const records = yield* store.listCheckpoints(threadId);
  const post = records.toReversed().find((record) => record.kind === "post-turn");
  const pre = records
    .toReversed()
    .find((record) => record.kind === "pre-turn" && record.turnId === post?.turnId);
  const publicRecords = records.map(toPersistedCheckpointWire);
  if (pre === undefined || post === undefined) {
    return { checkpoints: publicRecords, diff: { files: [] } };
  }
  return {
    checkpoints: publicRecords,
    diff: yield* checkpoints.diff(pre.checkpoint, post.checkpoint),
  };
}, widenReviewError);

export const previewFileRestore = Effect.fn("Review.previewFileRestore")(function* (
  threadId: ThreadId,
  checkpointId: CheckpointId,
) {
  const store = yield* Store;
  const checkpoints = yield* CheckpointService;
  const records = yield* store.listCheckpoints(threadId);
  const record = records.find((candidate) => candidate.checkpoint.id === checkpointId);
  if (record === undefined) return yield* Effect.fail(new CheckpointNotFound());
  return yield* checkpoints.previewRestore(record.checkpoint);
}, widenReviewError);

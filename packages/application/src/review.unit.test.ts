import { describe, expect, it } from "vitest";

import { CheckpointId, ThreadId, TurnId } from "@metaclanker/contracts/ids";

import { toPersistedCheckpointWire } from "./review.js";

describe("checkpoint transport projection", () => {
  it("does not expose checkpoint storage paths", () => {
    const projected = toPersistedCheckpointWire({
      checkpoint: {
        id: CheckpointId.make("checkpoint:public"),
        projectPath: "/private/project",
        snapshotPath: "/private/checkpoints/checkpoint:public",
        createdAt: "2026-08-03T00:00:00.000Z",
        files: [{ path: "README.md", size: 42, kind: "tracked" }],
      },
      threadId: ThreadId.make("thread:public"),
      turnId: TurnId.make("turn:public"),
      kind: "post-turn",
    });

    expect(projected).toEqual({
      checkpoint: {
        id: CheckpointId.make("checkpoint:public"),
        createdAt: "2026-08-03T00:00:00.000Z",
        files: [{ path: "README.md", size: 42, kind: "tracked" }],
      },
      threadId: ThreadId.make("thread:public"),
      turnId: TurnId.make("turn:public"),
      kind: "post-turn",
    });
    expect(projected.checkpoint).not.toHaveProperty("projectPath");
    expect(projected.checkpoint).not.toHaveProperty("snapshotPath");
  });
});

import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId } from "@metaclanker/contracts/ids";
import type { ShellSnapshot } from "@metaclanker/contracts/wire";

import { applyShellEvent } from "./live-shell-state.js";

describe("live shell state", () => {
  it("applies ordered events once and removes a project's threads with it", () => {
    const projectId = ProjectId.make("project:shell-live");
    const shell: ShellSnapshot = { projects: [], threads: [], latestSequence: 2 };
    const project = {
      id: projectId,
      name: "Shell live",
      path: "/tmp/shell-live",
      gitBranch: null,
      gitStatus: "unavailable" as const,
      hidden: false,
      order: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const thread = {
      id: ThreadId.make("thread:shell-live"),
      projectId,
      provider: "codex" as const,
      title: "Shell thread",
      status: "idle" as const,
      model: null,
      providerSessionId: null,
      archived: false,
      createdAt: "2026-08-01T00:00:01.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z",
    };

    const withProject = applyShellEvent(shell, {
      type: "project-upserted",
      sequence: 3,
      project,
    });
    const withThread = applyShellEvent(withProject, {
      type: "thread-upserted",
      sequence: 4,
      thread,
    });
    const repeated = applyShellEvent(withThread, {
      type: "thread-upserted",
      sequence: 4,
      thread,
    });
    const removed = applyShellEvent(repeated, {
      type: "project-removed",
      sequence: 5,
      projectId,
    });

    expect(repeated).toBe(withThread);
    expect(removed).toEqual({ projects: [], threads: [], latestSequence: 5 });
  });
});

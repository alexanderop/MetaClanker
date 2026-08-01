import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId, ToolCallId, TurnId, AgentNodeId } from "@metaclanker/contracts/ids";
import type { ServerEvent, ShellSnapshot, ThreadDetail } from "@metaclanker/contracts/wire";

import { applyThreadEvent } from "./live-thread-state.js";

const projectId = ProjectId.make("project:live-state");
const threadId = ThreadId.make("thread:live-state");
const thread = {
  id: threadId,
  projectId,
  provider: "codex" as const,
  title: "Live state",
  status: "running" as const,
  model: null,
  providerSessionId: null,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};
const shell: ShellSnapshot = { projects: [], threads: [thread], latestSequence: 4 };
const detail: ThreadDetail = {
  thread,
  messages: [],
  toolCalls: [],
  interactions: [],
  agentNodes: [],
  latestSequence: 4,
};

describe("live thread state", () => {
  it("ignores duplicate and out-of-order delivery", () => {
    const completed: ServerEvent = {
      type: "thread-status",
      sequence: 5,
      threadId,
      status: "completed",
    };
    const stale: ServerEvent = {
      type: "thread-status",
      sequence: 4,
      threadId,
      status: "running",
    };

    const once = applyThreadEvent({ shell, detail }, completed);
    const twice = applyThreadEvent(once, completed);
    const afterStale = applyThreadEvent(twice, stale);

    expect(afterStale).toBe(twice);
    expect(afterStale.detail.thread.status).toBe("completed");
    expect(afterStale.detail.latestSequence).toBe(5);
  });

  it("keeps a tool in its original chronological position when a later update arrives", () => {
    const base = applyThreadEvent(
      { shell, detail },
      {
        type: "tool-upserted",
        sequence: 5,
        toolCall: {
          id: ToolCallId.make("tool:live"),
          threadId,
          turnId: TurnId.make("turn:live"),
          nodeId: AgentNodeId.make("node:live"),
          title: "Inspect",
          kind: "read",
          status: "running",
          content: "",
          sequence: 5,
          createdAt: "2026-08-01T00:00:01.000Z",
          updatedAt: "2026-08-01T00:00:01.000Z",
        },
      },
    );
    const updated = applyThreadEvent(base, {
      type: "tool-upserted",
      sequence: 9,
      toolCall: {
        ...base.detail.toolCalls[0]!,
        sequence: 9,
        status: "completed",
        updatedAt: "2026-08-01T00:00:02.000Z",
      },
    });

    expect(updated.detail.toolCalls).toMatchObject([{ sequence: 5, status: "completed" }]);
    expect(updated.detail.latestSequence).toBe(9);
  });
});

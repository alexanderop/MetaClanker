import { describe, expect, it } from "vitest";

import {
  AgentNodeId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";

import { domainEventToThreadEvent, emptyEventProjection, projectDomainEvent } from "./events.js";
import type { DomainEvent } from "./events.js";

const projectId = ProjectId.make("project:replay");
const threadId = ThreadId.make("thread:replay");
const turnId = TurnId.make("turn:replay");

const metadata = (sequence: number) => ({
  schemaVersion: 1 as const,
  sequence,
  eventId: EventId.make(`event:${String(sequence)}`),
  receivedAt: `2026-08-01T00:00:0${String(sequence)}.000Z`,
  origin: "server" as const,
});

describe("domain event projection", () => {
  it("rebuilds shell and thread detail from canonical events alone", () => {
    const project = {
      id: projectId,
      name: "Replay project",
      path: "/tmp/replay-project",
      gitBranch: "main",
      gitStatus: "clean" as const,
      hidden: false,
      order: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const thread = {
      id: threadId,
      projectId,
      provider: "codex" as const,
      title: "Replay this thread",
      status: "running" as const,
      model: null,
      providerSessionId: null,
      archived: false,
      createdAt: "2026-08-01T00:00:01.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z",
    };
    const events: DomainEvent[] = [
      { ...metadata(1), type: "project.upserted", project },
      { ...metadata(2), type: "thread.upserted", thread },
      {
        ...metadata(3),
        type: "message.upserted",
        message: {
          id: MessageId.make("message:user"),
          threadId,
          turnId,
          role: "user",
          content: "Inspect the project",
          createdAt: "2026-08-01T00:00:02.000Z",
        },
      },
      {
        ...metadata(4),
        type: "tool.upserted",
        toolCall: {
          id: ToolCallId.make("tool:read"),
          threadId,
          turnId,
          nodeId: AgentNodeId.make("node:root"),
          title: "Read files",
          kind: "read",
          status: "completed",
          content: "README.md",
          createdAt: "2026-08-01T00:00:03.000Z",
          updatedAt: "2026-08-01T00:00:03.000Z",
        },
      },
      {
        ...metadata(5),
        type: "thread.status-changed",
        threadId,
        status: "completed",
        updatedAt: "2026-08-01T00:00:04.000Z",
      },
    ];

    const replayed = events.reduce(projectDomainEvent, emptyEventProjection());

    expect(replayed.shell).toEqual({
      projects: [project],
      threads: [{ ...thread, status: "completed", updatedAt: "2026-08-01T00:00:04.000Z" }],
      latestSequence: 5,
    });
    expect(replayed.threads[threadId]).toMatchObject({
      messages: [{ content: "Inspect the project", sequence: 3 }],
      toolCalls: [{ title: "Read files", sequence: 4 }],
      latestSequence: 5,
    });
  });

  it("deduplicates a repeated event sequence", () => {
    const event: DomainEvent = {
      ...metadata(1),
      type: "project.upserted",
      project: {
        id: projectId,
        name: "Only once",
        path: "/tmp/once",
        gitBranch: null,
        gitStatus: "unavailable",
        hidden: false,
        order: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    };
    const once = projectDomainEvent(emptyEventProjection(), event);

    expect(projectDomainEvent(once, event)).toBe(once);
  });

  it("replays derived child counts and saved checkpoints", () => {
    const rootNodeId = AgentNodeId.make("node:replay-root");
    const childNodeId = AgentNodeId.make("node:replay-child");
    const events: DomainEvent[] = [
      {
        ...metadata(1),
        type: "thread.upserted",
        thread: {
          id: threadId,
          projectId,
          provider: "codex",
          title: "Replay graph state",
          status: "running",
          model: null,
          providerSessionId: null,
          archived: false,
          createdAt: "2026-08-01T00:00:01.000Z",
          updatedAt: "2026-08-01T00:00:01.000Z",
        },
      },
      {
        ...metadata(2),
        type: "agent-node.upserted",
        node: {
          id: rootNodeId,
          threadId,
          parentId: null,
          name: "Root",
          provider: "codex",
          model: null,
          state: "running",
          activity: "Delegating",
          childCount: 0,
          pendingApproval: false,
          changedFileCount: 0,
        },
      },
      {
        ...metadata(3),
        type: "agent-node.upserted",
        node: {
          id: childNodeId,
          threadId,
          parentId: rootNodeId,
          name: "Child",
          provider: "codex",
          model: null,
          state: "running",
          activity: "Auditing",
          childCount: 0,
          pendingApproval: false,
          changedFileCount: 0,
        },
      },
      {
        ...metadata(4),
        type: "checkpoint.saved",
        record: {
          checkpoint: {
            id: "checkpoint:replay",
            projectPath: "/tmp/replay-project",
            createdAt: "2026-08-01T00:00:04.000Z",
            files: [{ path: "README.md", size: 42, kind: "tracked" }],
            snapshotPath: "/tmp/replay-snapshot",
          },
          threadId,
          turnId,
          kind: "post-turn",
        },
      },
    ];

    const replayed = events.reduce(projectDomainEvent, emptyEventProjection());

    expect(replayed.threads[threadId]?.agentNodes).toEqual([
      expect.objectContaining({ id: rootNodeId, childCount: 1 }),
      expect.objectContaining({ id: childNodeId, childCount: 0 }),
    ]);
    expect(replayed.checkpoints[threadId]).toHaveLength(1);
    expect(replayed.checkpoints[threadId]?.[0]?.checkpoint.id).toBe("checkpoint:replay");
    expect(replayed.checkpoints[threadId]?.[0]?.kind).toBe("post-turn");
  });

  it("maps only events owned by a subscribed thread", () => {
    const event: DomainEvent = {
      ...metadata(7),
      type: "message.upserted",
      message: {
        id: MessageId.make("message:live"),
        threadId,
        turnId,
        role: "agent",
        content: "Replayed from the cursor",
        createdAt: "2026-08-01T00:00:07.000Z",
      },
    };

    expect(domainEventToThreadEvent(event, threadId)).toMatchObject({
      type: "message-upserted",
      sequence: 7,
      message: { sequence: 7, content: "Replayed from the cursor" },
    });
    expect(domainEventToThreadEvent(event, ThreadId.make("thread:other"))).toBeNull();
  });
});

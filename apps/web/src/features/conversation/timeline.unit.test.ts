import { describe, expect, it } from "vitest";

import { AgentNodeId, MessageId, ThreadId, ToolCallId, TurnId } from "@metaclanker/contracts/ids";
import type { Message, ToolCall } from "@metaclanker/contracts/wire";

import { conversationTimeline } from "./timeline.js";

const threadId = ThreadId.make("thread:timeline");
const turnId = TurnId.make("turn:timeline");

describe("conversation timeline", () => {
  it("keeps tool activity between the messages that surrounded it", () => {
    const messages: Message[] = [
      {
        id: MessageId.make("message:user"),
        threadId,
        turnId,
        role: "user",
        content: "Inspect the project",
        sequence: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: MessageId.make("message:agent"),
        threadId,
        turnId,
        role: "agent",
        content: "Done",
        sequence: 3,
        createdAt: "2026-08-01T00:00:02.000Z",
      },
    ];
    const toolCalls: ToolCall[] = [
      {
        id: ToolCallId.make("tool:inspect"),
        threadId,
        turnId,
        nodeId: AgentNodeId.make("node:root"),
        title: "Inspect files",
        kind: "read",
        status: "completed",
        content: "README.md",
        sequence: 2,
        createdAt: "2026-08-01T00:00:01.000Z",
        updatedAt: "2026-08-01T00:00:01.000Z",
      },
    ];

    expect(conversationTimeline({ messages, toolCalls })).toEqual([
      { kind: "message", sequence: 1, message: messages[0] },
      { kind: "tool", sequence: 2, toolCall: toolCalls[0] },
      { kind: "message", sequence: 3, message: messages[1] },
    ]);
  });

  it("uses stable identifiers when two entries share a sequence", () => {
    const message = {
      id: MessageId.make("message:stable"),
      threadId,
      turnId,
      role: "agent" as const,
      content: "Answer",
      sequence: 4,
      createdAt: "2026-08-01T00:00:03.000Z",
    };
    const toolCall = {
      id: ToolCallId.make("tool:stable"),
      threadId,
      turnId,
      nodeId: AgentNodeId.make("node:root"),
      title: "Read",
      kind: "read",
      status: "completed" as const,
      content: "",
      sequence: 4,
      createdAt: "2026-08-01T00:00:03.000Z",
      updatedAt: "2026-08-01T00:00:03.000Z",
    };

    expect(conversationTimeline({ messages: [message], toolCalls: [toolCall] })).toEqual([
      { kind: "message", sequence: 4, message },
      { kind: "tool", sequence: 4, toolCall },
    ]);
  });
});

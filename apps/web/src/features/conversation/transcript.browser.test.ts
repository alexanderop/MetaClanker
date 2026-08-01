import { createPinia } from "pinia";
import { expect, test } from "vitest";

import {
  AgentNodeId,
  MessageId,
  ProjectId,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";
import type { ThreadDetail } from "@metaclanker/contracts/wire";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import { i18n } from "../../shared/i18n.js";
import Transcript from "./Transcript.vue";

const threadId = ThreadId.make("thread:tool-only");
const detail: ThreadDetail = {
  thread: {
    id: threadId,
    projectId: ProjectId.make("project:tool-only"),
    provider: "codex",
    title: "Tool-only activity",
    status: "running",
    model: null,
    providerSessionId: null,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  messages: [],
  toolCalls: [
    {
      id: ToolCallId.make("tool:only"),
      threadId,
      turnId: TurnId.make("turn:tool-only"),
      nodeId: AgentNodeId.make("node:tool-only"),
      title: "Inspect workspace",
      kind: "read",
      status: "running",
      content: "README.md",
      sequence: 1,
      createdAt: "2026-08-01T00:00:01.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z",
    },
  ],
  interactions: [],
  agentNodes: [],
  latestSequence: 1,
};

test("tool-only activity does not also announce an empty conversation", async () => {
  const screen = await renderFeature(Transcript, {
    props: { detail },
    global: { plugins: [createPinia(), i18n] },
  });

  await expect.element(screen.getByText("Inspect workspace")).toBeVisible();
  await expect
    .element(screen.getByText("Start this conversation with a prompt."))
    .not.toBeInTheDocument();
});

test("large histories disclose older activity in bounded pages", async () => {
  const history: ThreadDetail = {
    ...detail,
    thread: { ...detail.thread, status: "completed" },
    toolCalls: [],
    messages: Array.from({ length: 205 }, (_, index) => ({
      id: MessageId.make(`message:${index}`),
      threadId,
      turnId: TurnId.make(`turn:${index}`),
      role: "user" as const,
      content: `History message ${index}`,
      sequence: index + 1,
      createdAt: `2026-08-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    })),
    latestSequence: 205,
  };
  const screen = await renderFeature(Transcript, {
    props: { detail: history },
    global: { plugins: [createPinia(), i18n] },
  });

  await expect.element(screen.getByText("History message 204")).toBeVisible();
  await expect.element(screen.getByText("History message 0")).not.toBeInTheDocument();
  const earlier = screen.getByRole("button", { name: "Show 5 earlier activities" });
  await earlier.click();
  await expect.element(screen.getByText("History message 0")).toBeInTheDocument();
  await expect.element(earlier).not.toBeInTheDocument();
});

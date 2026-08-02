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

import { createAppAtomModel } from "../../app-atom-model.js";
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
    atomModel: createAppAtomModel(),
    props: { detail },
    global: { plugins: [createPinia(), i18n] },
  });

  await expect.element(screen.getByText("Inspect workspace")).toBeVisible();
  await expect
    .element(screen.getByText("Start this conversation with a prompt."))
    .not.toBeInTheDocument();
});

test("the transcript exposes timestamped role and activity hierarchy", async () => {
  const hierarchy: ThreadDetail = {
    ...detail,
    thread: { ...detail.thread, status: "completed" },
    messages: [
      {
        id: MessageId.make("message:user-hierarchy"),
        threadId,
        turnId: TurnId.make("turn:hierarchy"),
        role: "user",
        content: "Please inspect the workspace",
        sequence: 1,
        createdAt: "2026-08-01T10:00:00.000Z",
      },
      {
        id: MessageId.make("message:thought-hierarchy"),
        threadId,
        turnId: TurnId.make("turn:hierarchy"),
        role: "thought",
        content: "I should read the project guide first.",
        sequence: 3,
        createdAt: "2026-08-01T10:01:00.000Z",
      },
      {
        id: MessageId.make("message:agent-hierarchy"),
        threadId,
        turnId: TurnId.make("turn:hierarchy"),
        role: "agent",
        content: "The workspace is ready.",
        sequence: 4,
        createdAt: "2026-08-01T10:02:00.000Z",
      },
    ],
    toolCalls: [{ ...detail.toolCalls[0]!, sequence: 2 }],
    latestSequence: 4,
  };
  const screen = await renderFeature(Transcript, {
    atomModel: createAppAtomModel(),
    props: { detail: hierarchy },
    global: { plugins: [createPinia(), i18n] },
  });
  const userTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(hierarchy.messages[0]!.createdAt));

  await expect.element(screen.getByLabelText(`Sent at ${userTime}`)).toBeVisible();
  await expect
    .element(screen.getByLabelText("Activity: Inspect workspace"))
    .toHaveTextContent("running");
  const thought = screen.getByRole("article", { name: "thought message" });
  await expect
    .element(thought.getByText("I should read the project guide first."))
    .not.toBeVisible();
  await thought.getByText("Thought summary").click();
  await expect.element(thought.getByText("I should read the project guide first.")).toBeVisible();
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
    atomModel: createAppAtomModel(),
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

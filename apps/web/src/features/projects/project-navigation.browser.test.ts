import axe from "axe-core";
import { createPinia } from "pinia";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";

import { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";
import { defaultUserSettings } from "@metaclanker/contracts/wire";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import App from "../../App.vue";
import { i18n } from "../../shared/i18n.js";
import { router } from "../../views/router.js";

const project = {
  id: ProjectId.make("project:browser"),
  name: "Demo workspace",
  path: "/tmp/metaclanker-browser-project",
  gitBranch: null,
  gitStatus: "unavailable" as const,
  hidden: false,
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const thread = {
  id: ThreadId.make("thread:browser-first-send"),
  projectId: project.id,
  provider: "codex" as const,
  title: "Inspect the draft workflow",
  status: "running" as const,
  model: null,
  providerSessionId: null,
  archived: false,
  createdAt: "2026-08-01T00:00:01.000Z",
  updatedAt: "2026-08-01T00:00:01.000Z",
};

let startRequests: unknown[] = [];
let eventClient: { send: (data: string) => void } | null = null;
const threadEvents = ws
  .link("/api/threads/:id/events")
  .addEventListener("connection", ({ client }) => {
    eventClient = client;
    client.send("pong");
  });

const worker = setupWorker(
  threadEvents,
  http.post("/api/auth/local", () => HttpResponse.json({ authenticated: true })),
  http.get("/api/shell", () => HttpResponse.json({ projects: [], threads: [], latestSequence: 0 })),
  http.get("/api/settings", () => HttpResponse.json(defaultUserSettings)),
  http.get("/api/providers", () =>
    HttpResponse.json([
      { provider: "codex", status: "ready", reason: null },
      { provider: "claude", status: "ready", reason: null },
    ]),
  ),
  http.get("/api/projects/directories", () =>
    HttpResponse.json({ currentPath: project.path, parentPath: null, entries: [] }),
  ),
  http.post("/api/projects", () => HttpResponse.json(project)),
  http.post("/api/threads/start", async ({ request }) => {
    startRequests.push(await request.json());
    return HttpResponse.json({ accepted: true, thread, turnId: TurnId.make("turn:browser") });
  }),
  http.get("/api/threads/:id", () =>
    HttpResponse.json({
      thread,
      messages: [
        {
          id: "message:browser",
          threadId: thread.id,
          turnId: "turn:browser",
          role: "user",
          content: "Inspect the draft workflow",
          sequence: 1,
          createdAt: thread.createdAt,
        },
      ],
      toolCalls: [],
      interactions: [],
      agentNodes: [],
      latestSequence: 1,
    }),
  ),
  http.post("/api/auth/ticket", () => HttpResponse.json({ ticket: "browser-ticket" })),
);

beforeAll(async () => {
  await worker.start({
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith("/api/")) print.error();
    },
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
});

beforeEach(() => {
  worker.resetHandlers();
  startRequests = [];
  eventClient = null;
  window.localStorage.clear();
});

afterAll(() => worker.stop());

test("project onboarding continues to a local draft and first send promotes exactly once", async () => {
  await router.push("/");
  await router.isReady();
  const screen = await renderFeature(App, { global: { plugins: [createPinia(), router, i18n] } });

  await screen.getByRole("button", { name: "Add project" }).first().click();
  const projectDialog = screen.getByRole("dialog", { name: "Choose a server project directory" });
  await expect.element(projectDialog.getByText(project.path)).toBeVisible();
  await projectDialog.getByRole("button", { name: "Add project" }).click();

  await expect
    .element(screen.getByRole("heading", { name: /What should we work on in.*Demo workspace/ }))
    .toBeVisible();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    "Ask the agent to build, investigate, or explain…",
  );
  expect(startRequests).toHaveLength(0);
  expect(window.localStorage.getItem("metaclanker:conversation-drafts:v2")).not.toBeNull();

  await composer.fill("Inspect the draft workflow");
  await router.push("/");
  expect(startRequests).toHaveLength(0);
  await screen.getByRole("button", { name: "New chat" }).first().click();
  await expect.element(composer).toHaveValue("Inspect the draft workflow");

  await composer.click();
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("heading", { name: thread.title })).toBeVisible();
  expect(startRequests).toHaveLength(1);
  expect(startRequests[0]).toMatchObject({
    projectId: project.id,
    provider: "codex",
    prompt: "Inspect the draft workflow",
  });
  expect(window.localStorage.getItem("metaclanker:conversation-drafts:v2")).toBe("{}");
});

test("a stored project draft survives a fresh app mount with its controls and cursor", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
  );
  window.localStorage.setItem(
    "metaclanker:conversation-drafts:v2",
    JSON.stringify({
      [project.id]: {
        projectId: project.id,
        commandId: "command:browser-restart",
        prompt: "Resume this draft",
        provider: "claude",
        model: "claude-restart-model",
        effort: "medium",
        permissionMode: "workspace-write",
        attachments: ["file:///srv/restart.md"],
        cursorStart: 6,
        cursorEnd: 10,
      },
    }),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderFeature(App, { global: { plugins: [createPinia(), router, i18n] } });

  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  await expect.element(composer).toHaveValue("Resume this draft");
  await expect.element(screen.getByLabelText("Provider")).toHaveValue("claude");
  await expect.element(screen.getByLabelText("Model")).toHaveValue("claude-restart-model");
  await expect.element(screen.getByLabelText("Effort")).toHaveValue("medium");
  await expect.element(screen.getByLabelText("Permissions")).toHaveValue("workspace-write");
  await expect.element(screen.getByText("file:///srv/restart.md")).toBeVisible();
  const textarea = composer.element() as HTMLTextAreaElement;
  expect(textarea.selectionStart).toBe(6);
  expect(textarea.selectionEnd).toBe(10);
  expect(startRequests).toHaveLength(0);

  const accessibility = await axe.run(document);
  expect(
    accessibility.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

test("a completed live turn updates its sidebar status without a reload", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [thread], latestSequence: 1 }),
    ),
  );
  await router.push({ name: "thread", params: { threadId: thread.id } });
  await router.isReady();
  const screen = await renderFeature(App, { global: { plugins: [createPinia(), router, i18n] } });

  await expect
    .element(screen.getByRole("status", { name: "Thread status: running" }))
    .toBeVisible();
  expect(eventClient).not.toBeNull();
  eventClient?.send(
    JSON.stringify({
      type: "thread-status",
      sequence: 2,
      threadId: thread.id,
      status: "completed",
    }),
  );

  await expect
    .element(screen.getByRole("status", { name: "Thread status: completed" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: new RegExp(`${thread.title}.*completed`, "i") }))
    .toBeVisible();
});

test("a rejected first send preserves every local draft field and reuses its command identity", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
    http.post("/api/threads/start", async ({ request }) => {
      startRequests.push(await request.json());
      return HttpResponse.json(
        { message: `Claude needs authentication (attempt ${String(startRequests.length)})` },
        { status: 409 },
      );
    }),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderFeature(App, { global: { plugins: [createPinia(), router, i18n] } });

  await screen
    .getByRole("textbox", { name: "Ask the agent to build, investigate, or explain…" })
    .fill("Preserve this complete draft");
  await screen.getByLabelText("Provider").selectOptions("claude");
  await screen.getByLabelText("Model").fill("claude-test-model");
  await screen.getByLabelText("Effort").selectOptions("high");
  await screen.getByLabelText("Permissions").selectOptions("read-only");
  await screen.getByLabelText("Attach a server file or resource URI").fill("file:///srv/demo.md");
  await screen.getByRole("button", { name: "Attach", exact: true }).click();

  await screen.getByRole("button", { name: "Send message" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Claude needs authentication (attempt 1)");
  await screen.getByRole("button", { name: "Send message" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Claude needs authentication (attempt 2)");

  expect(startRequests[0]).toMatchObject({
    projectId: project.id,
    provider: "claude",
    model: "claude-test-model",
    effort: "high",
    permissionMode: "read-only",
    prompt: "Preserve this complete draft",
    attachments: ["file:///srv/demo.md"],
  });
  expect(startRequests[1]).toMatchObject({
    commandId: (startRequests[0] as { commandId: string }).commandId,
  });
  expect(
    JSON.parse(window.localStorage.getItem("metaclanker:conversation-drafts:v2") ?? "{}"),
  ).toMatchObject({
    [project.id]: {
      prompt: "Preserve this complete draft",
      provider: "claude",
      model: "claude-test-model",
      effort: "high",
      permissionMode: "read-only",
      attachments: ["file:///srv/demo.md"],
    },
  });
  expect(screen.getByText("Preserve this complete draft")).toBeDefined();

  await screen.getByRole("button", { name: "Discard draft" }).click();
  const discardDialog = screen.getByRole("dialog", { name: "Discard this draft?" });
  await expect.element(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Keep draft" }).click();
  await expect
    .element(
      screen.getByRole("textbox", { name: "Ask the agent to build, investigate, or explain…" }),
    )
    .toHaveValue("Preserve this complete draft");
});

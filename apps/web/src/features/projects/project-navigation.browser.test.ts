import axe from "axe-core";
import { createPinia } from "pinia";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";

import {
  AgentNodeId,
  PendingInteractionId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@metaclanker/contracts/ids";
import type { Thread } from "@metaclanker/contracts/wire";
import { defaultUserSettings } from "@metaclanker/contracts/wire";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import App from "../../App.vue";
import { createAppAtomModel } from "../../app-atom-model.js";
import { i18n } from "../../shared/i18n.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
};
import { router } from "../../views/router.js";

const renderApp = (pinia = createPinia()) =>
  renderFeature(App, {
    atomModel: createAppAtomModel(),
    global: { plugins: [pinia, router, i18n] },
  });

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

const secondProject = {
  ...project,
  id: ProjectId.make("project:browser-second"),
  name: "Docs workspace",
  path: "/tmp/metaclanker-browser-second-project",
};

const thread: Thread = {
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

const slowerThread = {
  ...thread,
  id: ThreadId.make("thread:browser-slower"),
  title: "Slower conversation",
};

const threadDetail = (value: typeof thread) => ({
  thread: value,
  messages: [
    {
      id: `message:${value.id}`,
      threadId: value.id,
      turnId: "turn:browser",
      role: "user" as const,
      content: value.title,
      sequence: 1,
      createdAt: value.createdAt,
    },
  ],
  toolCalls: [],
  interactions: [],
  agentNodes: [],
  latestSequence: 1,
});

let startRequests: unknown[] = [];
let eventClient: { send: (data: string) => void } | null = null;
const threadEvents = ws
  .link("/api/threads/:id/events")
  .addEventListener("connection", ({ client }) => {
    eventClient = client;
    client.send("pong");
  });
const shellEvents = ws.link("/api/shell/events").addEventListener("connection", ({ client }) => {
  client.send("pong");
});

const worker = setupWorker(
  threadEvents,
  shellEvents,
  http.post("/api/auth/local", () => HttpResponse.json({ authenticated: true })),
  http.get("/api/shell", () => HttpResponse.json({ projects: [], threads: [], latestSequence: 0 })),
  http.get("/api/settings", () => HttpResponse.json(defaultUserSettings)),
  http.get("/api/providers", () =>
    HttpResponse.json([
      { provider: "codex", status: "ready", reason: null, models: [] },
      { provider: "claude", status: "ready", reason: null, models: [] },
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

test("the command palette is visible and focuses its first action", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
  );
  await router.push("/");
  await router.isReady();
  const screen = await renderApp();

  const paletteEntry = screen.getByRole("button", { name: "Search conversations" });
  await expect.element(paletteEntry).toBeVisible();
  await expect.element(paletteEntry).toHaveTextContent(/(?:⌘K|Ctrl K)/);
  await paletteEntry.click();

  await expect.element(screen.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  expect(document.activeElement?.textContent?.trim()).toBe("New chat");
});

test("theme settings preview, cancel, report failure, and save without duplicate requests", async () => {
  const saveStarted = deferred();
  const releaseFailure = deferred();
  const settingsBodies: unknown[] = [];
  worker.use(
    http.get("/api/settings", () => HttpResponse.json(defaultUserSettings)),
    http.put("/api/settings", async ({ request }) => {
      const body = await request.json();
      settingsBodies.push(body);
      if (settingsBodies.length === 1) {
        saveStarted.resolve();
        await releaseFailure.promise;
        return HttpResponse.json(
          { error: { message: "Settings temporarily unavailable" } },
          { status: 503 },
        );
      }
      return HttpResponse.json(body);
    }),
  );
  await router.push("/");
  await router.isReady();
  const screen = await renderApp();
  const trigger = screen.getByRole("button", { name: "Workspace settings" });

  await trigger.click();
  let dialog = screen.getByRole("dialog", { name: "Workspace settings" });
  await dialog.getByRole("combobox", { name: "Theme" }).selectOptions("dark");
  expect(document.documentElement.dataset["theme"]).toBe("dark");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(document.documentElement.dataset["theme"]).toBeUndefined();
  await expect.element(trigger).toHaveFocus();

  await trigger.click();
  dialog = screen.getByRole("dialog", { name: "Workspace settings" });
  await dialog.getByRole("combobox", { name: "Theme" }).selectOptions("dark");
  await dialog.getByRole("button", { name: "Save" }).click();
  await saveStarted.promise;
  await expect.element(dialog.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(settingsBodies).toHaveLength(1);
  releaseFailure.resolve();

  await expect.element(dialog.getByText("Settings temporarily unavailable")).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(settingsBodies).toHaveLength(2);
  expect(settingsBodies[1]).toMatchObject({ theme: "dark" });
  expect(document.documentElement.dataset["theme"]).toBe("dark");
  await expect.element(trigger).toHaveFocus();
});

test("an empty workspace leads with local project onboarding", async () => {
  await router.push("/");
  await router.isReady();
  const screen = await renderApp();
  const onboarding = screen.getByRole("region", { name: "What should we work on?" });

  await expect
    .element(onboarding.getByText("Add a server-side project directory to begin."))
    .toBeVisible();
  await expect.element(onboarding.getByRole("button", { name: "Open settings" })).toBeVisible();

  await onboarding.getByRole("button", { name: "Add project" }).click();

  await expect
    .element(screen.getByRole("dialog", { name: "Choose a server project directory" }))
    .toBeVisible();
});

test("provider selection explains unavailable choices and enables a ready alternative", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
    http.get("/api/providers", () =>
      HttpResponse.json([
        {
          provider: "codex",
          status: "unavailable",
          reason: "Codex CLI not found",
          models: [],
        },
        { provider: "claude", status: "ready", reason: null, models: [] },
      ]),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  const provider = screen.getByLabelText("Provider");

  await composer.fill("Inspect provider readiness");
  await expect.element(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(
      "Codex is unavailable: Codex CLI not found. Choose another provider or open settings.",
    );
  await expect
    .element(screen.getByRole("option", { name: "Codex — unavailable: Codex CLI not found" }))
    .toBeDisabled();

  await provider.click();
  expect(document.activeElement).toBe(provider.element());
  await provider.selectOptions("claude");

  await expect.element(provider).toHaveValue("claude");
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  expect(document.activeElement).toBe(provider.element());
});

test("the Claude model catalog exposes advertised Sonnet and accepts a custom model", async () => {
  let providerRequestCount = 0;
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
    http.get("/api/providers", () => {
      providerRequestCount += 1;
      return HttpResponse.json([
        {
          provider: "codex",
          status: "ready",
          reason: null,
          models: [],
        },
        {
          provider: "claude",
          status: "ready",
          reason: null,
          models: providerRequestCount > 1 ? ["default", "sonnet", "opus[1m]"] : [],
        },
      ]);
    }),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  await screen.getByLabelText("Provider").selectOptions("claude");
  const trigger = screen.getByRole("button", { name: "Browse catalog" });

  await trigger.click();

  const dialog = screen.getByRole("dialog", { name: "Choose model" });
  const search = dialog.getByRole("textbox", { name: "Search models" });
  await expect.element(dialog).toBeVisible();
  expect(document.activeElement).toBe(search.element());
  await expect.element(dialog.getByRole("button", { name: "Provider default" })).toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "sonnet" })).toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "opus[1m]" })).toBeVisible();
  expect(providerRequestCount).toBe(2);

  await search.fill("sonn");
  await expect.element(dialog.getByRole("button", { name: "sonnet" })).toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "opus[1m]" })).not.toBeInTheDocument();
  await dialog.getByRole("button", { name: "sonnet" }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText("Model", { exact: true })).toHaveValue("sonnet");
  expect(document.activeElement).toBe(trigger.element());

  await trigger.click();
  await dialog.getByRole("textbox", { name: "Search models" }).fill("custom-preview-model");
  await dialog.getByRole("button", { name: "Use custom model custom-preview-model" }).click();

  await expect
    .element(screen.getByLabelText("Model", { exact: true }))
    .toHaveValue("custom-preview-model");
  expect(document.activeElement).toBe(trigger.element());
});

test("effort selection preserves the draft and follows provider defaults", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
    http.get("/api/settings", () =>
      HttpResponse.json({
        ...defaultUserSettings,
        providerDefaults: {
          ...defaultUserSettings.providerDefaults,
          claude: {
            ...defaultUserSettings.providerDefaults.claude,
            effort: "low",
          },
        },
      }),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  const effort = screen.getByRole("combobox", { name: "Effort", exact: true });
  const provider = screen.getByRole("combobox", { name: "Provider", exact: true });

  await composer.fill("Keep this prompt while effort changes");
  await userEvent.keyboard("{Tab}{Tab}{Tab}{Tab}");
  expect(document.activeElement).toBe(effort.element());
  await userEvent.selectOptions(effort.element(), "high");

  await expect.element(effort).toHaveValue("high");
  await expect.element(composer).toHaveValue("Keep this prompt while effort changes");
  expect(document.activeElement).toBe(effort.element());

  await userEvent.selectOptions(effort.element(), "");
  await expect.element(effort).toHaveValue("");
  await provider.click();
  expect(document.activeElement).toBe(provider.element());
  await provider.selectOptions("claude");
  await expect.element(effort).toHaveValue("low");
  await expect.element(composer).toHaveValue("Keep this prompt while effort changes");
  expect(document.activeElement).toBe(provider.element());
});

test("permission selection explains risk and follows provider defaults", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
    http.get("/api/settings", () =>
      HttpResponse.json({
        ...defaultUserSettings,
        providerDefaults: {
          ...defaultUserSettings.providerDefaults,
          claude: {
            ...defaultUserSettings.providerDefaults.claude,
            permissionMode: "workspace-write",
          },
        },
      }),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  const permission = screen.getByRole("combobox", { name: "Permissions", exact: true });
  const provider = screen.getByRole("combobox", { name: "Provider", exact: true });

  await expect.element(screen.getByText("Use Codex's configured permission mode.")).toBeVisible();
  await composer.fill("Keep this prompt while permissions change");
  await permission.click();
  await userEvent.selectOptions(permission.element(), "read-only");

  await expect.element(permission).toHaveValue("read-only");
  await expect.element(screen.getByText("Request a read-only provider session.")).toBeVisible();
  await expect.element(composer).toHaveValue("Keep this prompt while permissions change");
  expect(document.activeElement).toBe(permission.element());

  await userEvent.selectOptions(permission.element(), "");
  await provider.click();
  await provider.selectOptions("claude");
  await expect.element(permission).toHaveValue("workspace-write");
  await expect.element(screen.getByText("Allow edits inside the project workspace.")).toBeVisible();
  await expect.element(composer).toHaveValue("Keep this prompt while permissions change");
  expect(document.activeElement).toBe(provider.element());
});

test("project onboarding continues to a local draft and first send promotes exactly once", async () => {
  await router.push("/");
  await router.isReady();
  const screen = await renderApp();

  await screen.getByRole("button", { name: "Add project" }).first().click();
  const projectDialog = screen.getByRole("dialog", { name: "Choose a server project directory" });
  await expect.element(projectDialog.getByText(project.path)).toBeVisible();
  await projectDialog.getByRole("button", { name: "Add project" }).click();

  await expect.element(screen.getByRole("heading", { name: "New chat" })).toBeVisible();
  await expect.element(screen.getByLabelText("Project", { exact: true })).toHaveValue(project.id);
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

test("first send shows pending feedback and focuses the promoted conversation", async () => {
  const startGate = deferred();
  const requestStarted = deferred();
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
    http.post("/api/threads/start", async ({ request }) => {
      startRequests.push(await request.json());
      requestStarted.resolve();
      await startGate.promise;
      return HttpResponse.json({ accepted: true, thread, turnId: TurnId.make("turn:browser") });
    }),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });

  await composer.click();
  await userEvent.keyboard("Line one{Shift>}{Enter}{/Shift}Line two");
  await expect.element(composer).toHaveValue("Line one\nLine two");
  expect(startRequests).toHaveLength(0);

  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("status")).toHaveTextContent("Starting conversation…");
  await expect.element(screen.getByRole("button", { name: "Sending message" })).toBeDisabled();
  await expect.element(composer).toBeDisabled();
  await requestStarted.promise;
  expect(startRequests).toHaveLength(1);

  startGate.resolve();
  await expect.element(screen.getByRole("heading", { name: thread.title })).toBeVisible();
  const promotedComposer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  expect(document.activeElement).toBe(promotedComposer.element());
});

test("a rejected follow-up keeps its draft across navigation with visible feedback", async () => {
  const requestStarted = deferred();
  const responseGate = deferred();
  const promptCommandIds: unknown[] = [];
  const completedThread = { ...thread, status: "completed" as const };
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [completedThread], latestSequence: 1 }),
    ),
    http.get("/api/threads/:id", () => HttpResponse.json(threadDetail(completedThread))),
    http.post("/api/threads/:id/prompts", async ({ request }) => {
      const body: unknown = await request.json();
      promptCommandIds.push(
        typeof body === "object" && body !== null && "commandId" in body
          ? body.commandId
          : undefined,
      );
      if (promptCommandIds.length === 1) {
        requestStarted.resolve();
        await responseGate.promise;
        return HttpResponse.json(
          { message: "The provider rejected this follow-up" },
          { status: 409 },
        );
      }
      return HttpResponse.json({ accepted: true, turnId: "turn:browser-follow-up-retry" });
    }),
  );
  await router.push({ name: "thread", params: { threadId: completedThread.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });

  await composer.click();
  await userEvent.keyboard("Keep this{Shift>}{Enter}{/Shift}follow-up draft");
  await expect.element(composer).toHaveValue("Keep this\nfollow-up draft");
  expect(promptCommandIds).toHaveLength(0);

  await composer.fill("Keep this rejected follow-up");
  await userEvent.keyboard("{Enter}");
  await requestStarted.promise;
  await expect
    .element(screen.getByRole("status", { name: "Sending follow-up…" }))
    .toHaveTextContent("Sending follow-up…");
  await expect.element(screen.getByRole("button", { name: "Sending message" })).toBeDisabled();

  responseGate.resolve();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The provider rejected this follow-up Your message is still here.");
  await expect.element(composer).toHaveValue("Keep this rejected follow-up");
  expect(document.activeElement).toBe(composer.element());

  await router.push("/");
  await router.push({ name: "thread", params: { threadId: completedThread.id } });
  await expect.element(composer).toHaveValue("Keep this rejected follow-up");
  expect(document.activeElement).toBe(composer.element());

  await userEvent.keyboard("{Enter}");
  await expect.element(composer).toHaveValue("");
  expect(promptCommandIds).toHaveLength(2);
  expect(promptCommandIds[1]).toBe(promptCommandIds[0]);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.activeElement).toBe(composer.element());
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
  const screen = await renderApp();

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

test("switching projects preserves each local draft and restores composer focus", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project, secondProject], threads: [], latestSequence: 0 }),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  const projectSelect = screen.getByLabelText("Project", { exact: true });

  await composer.fill("First project draft");
  await screen.getByLabelText("Model").fill("first-project-model");
  await projectSelect.selectOptions(secondProject.id);

  await expect.element(composer).toHaveValue("");
  expect(document.activeElement).toBe(composer.element());
  await composer.fill("Second project draft");

  await projectSelect.selectOptions(project.id);
  await expect.element(composer).toHaveValue("First project draft");
  await expect.element(screen.getByLabelText("Model")).toHaveValue("first-project-model");
  expect(document.activeElement).toBe(composer.element());

  await projectSelect.selectOptions(secondProject.id);
  await expect.element(composer).toHaveValue("Second project draft");
  expect(document.activeElement).toBe(composer.element());
});

test("draft discard is immediate when empty and confirmable when it has content", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();

  await screen.getByRole("button", { name: "Discard draft" }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Start a new conversation" }))
    .toBeVisible();

  await screen.getByRole("button", { name: "New chat" }).first().click();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  await composer.fill("Keep or discard this draft");
  const discard = screen.getByRole("button", { name: "Discard draft" });
  await discard.click();

  const dialog = screen.getByRole("dialog", { name: "Discard this draft?" });
  const keep = dialog.getByRole("button", { name: "Keep draft" });
  await expect.element(dialog).toBeVisible();
  expect(document.activeElement).toBe(keep.element());
  await keep.click();
  await expect.element(composer).toHaveValue("Keep or discard this draft");
  expect(document.activeElement).toBe(discard.element());

  await discard.click();
  await dialog.getByRole("button", { name: "Discard draft" }).click();

  await expect
    .element(screen.getByRole("heading", { name: "Start a new conversation" }))
    .toBeVisible();

  await screen.getByRole("button", { name: "New chat" }).first().click();
  await expect.element(composer).toHaveValue("");
  expect(document.activeElement).toBe(composer.element());
  await discard.click();
});

test("a new chat uses the conversation shell with a bottom composer", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();

  await expect.element(screen.getByRole("heading", { name: "New chat" })).toBeVisible();
  await expect
    .element(screen.getByText("Send a message to start the conversation.", { exact: true }))
    .toBeVisible();
  const attachmentToggle = screen.getByRole("button", { name: "Add attachment" });
  await expect.element(attachmentToggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByLabelText("Attach a server file or resource URI"))
    .not.toBeInTheDocument();

  await attachmentToggle.click();
  await expect.element(attachmentToggle).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByLabelText("Attach a server file or resource URI")).toBeVisible();
});

test("draft attachments validate, deduplicate, and restore focus when removed", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [], latestSequence: 0 }),
    ),
  );
  await router.push({ name: "draft", params: { projectId: project.id } });
  await router.isReady();
  const screen = await renderApp();
  const toggle = screen.getByRole("button", { name: "Add attachment" });
  const send = screen.getByRole("button", { name: "Send message" });

  await toggle.click();
  const input = screen.getByLabelText("Attach a server file or resource URI");
  expect(document.activeElement).toBe(input.element());

  await screen.getByRole("button", { name: "Attach", exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Enter a valid absolute resource URI.");
  expect(document.activeElement).toBe(input.element());

  await input.fill("notes.md");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Enter a valid absolute resource URI.");

  await input.fill("file:///srv/demo.md");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("file:///srv/demo.md", { exact: true })).toBeVisible();
  await expect.element(input).toHaveValue("");
  await expect.element(send).toBeEnabled();
  expect(document.activeElement).toBe(input.element());

  await input.fill("file:///srv/demo.md");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This resource URI is already attached.");
  expect(
    JSON.parse(window.localStorage.getItem("metaclanker:conversation-drafts:v2") ?? "{}"),
  ).toMatchObject({ [project.id]: { attachments: ["file:///srv/demo.md"] } });

  await screen.getByRole("button", { name: "Remove file:///srv/demo.md" }).click();
  await expect
    .element(screen.getByText("file:///srv/demo.md", { exact: true }))
    .not.toBeInTheDocument();
  await expect.element(send).toBeDisabled();
  expect(document.activeElement).toBe(input.element());
});

test("a completed live turn updates its sidebar status without a reload", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [thread], latestSequence: 1 }),
    ),
  );
  await router.push({ name: "thread", params: { threadId: thread.id } });
  await router.isReady();
  const screen = await renderApp();

  await expect
    .element(screen.getByRole("status", { name: "Thread status: Running" }))
    .toBeVisible();
  expect(eventClient).not.toBeNull();
  eventClient?.send(
    JSON.stringify({
      type: "thread-status",
      sequence: 2,
      threadId: thread.id,
      status: "needs-input",
    }),
  );

  await expect
    .element(screen.getByRole("status", { name: "Thread status: Needs input" }))
    .toHaveTextContent("Needs input");
  await expect
    .element(screen.getByRole("link", { name: new RegExp(`${thread.title}.*Needs input`, "i") }))
    .toBeVisible();

  eventClient?.send(
    JSON.stringify({
      type: "thread-status",
      sequence: 3,
      threadId: thread.id,
      status: "completed",
    }),
  );

  await expect
    .element(screen.getByRole("status", { name: "Thread status: Completed" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: new RegExp(`${thread.title}.*completed`, "i") }))
    .toBeVisible();
});

test("a failed thread load retries the requested conversation without losing its route", async () => {
  let threadRequests = 0;
  const retryStarted = deferred();
  const retryGate = deferred();
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [thread], latestSequence: 1 }),
    ),
    http.get("/api/threads/:id", async () => {
      threadRequests += 1;
      if (threadRequests === 1) {
        return HttpResponse.json(
          { error: { code: "temporarily-unavailable", message: "Thread temporarily unavailable" } },
          { status: 503 },
        );
      }
      if (threadRequests === 2) {
        retryStarted.resolve();
        await retryGate.promise;
      }
      return HttpResponse.json(threadDetail(thread));
    }),
  );
  await router.push({ name: "thread", params: { threadId: thread.id } });
  await router.isReady();
  const screen = await renderApp();

  const failure = screen.getByRole("alert");
  await expect.element(failure).toHaveTextContent("Thread temporarily unavailable");
  await failure.getByRole("button", { name: "Try again" }).click();
  await retryStarted.promise;
  await expect.element(failure).toHaveTextContent("Thread temporarily unavailable");
  await expect.element(failure.getByRole("button", { name: "Trying again…" })).toBeDisabled();
  retryGate.resolve();

  await expect.element(screen.getByRole("heading", { name: thread.title })).toBeVisible();
  expect(router.currentRoute.value.params["threadId"]).toBe(thread.id);
  expect(threadRequests).toBeGreaterThanOrEqual(2);
});

test("the workspace surface switch keeps its thread route and follow-up draft", async () => {
  const completedThread = { ...thread, status: "completed" as const };
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [completedThread], latestSequence: 1 }),
    ),
    http.get("/api/threads/:id", () => HttpResponse.json(threadDetail(completedThread))),
  );
  await router.push({ name: "thread", params: { threadId: completedThread.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });
  const conversation = screen.getByRole("button", { name: "Conversation", exact: true });
  const map = screen.getByRole("button", { name: "Agent map", exact: true });

  await composer.fill("Keep this draft while changing surfaces");
  map.element().focus();
  await userEvent.keyboard("{Enter}");

  await expect.element(map).toHaveAttribute("data-state", "on");
  await expect.element(screen.getByRole("heading", { name: "Agent map" })).toBeVisible();
  expect(router.currentRoute.value.params["threadId"]).toBe(completedThread.id);
  expect(router.currentRoute.value.query["surface"]).toBe("map");

  await conversation.click();
  await expect.element(conversation).toHaveAttribute("data-state", "on");
  await expect.element(composer).toHaveValue("Keep this draft while changing surfaces");
  expect(router.currentRoute.value.params["threadId"]).toBe(completedThread.id);
  expect(router.currentRoute.value.query["surface"]).toBeUndefined();
});

test("a non-Git project keeps review feedback keyboard-discoverable", async () => {
  const completedThread = { ...thread, status: "completed" as const };
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [completedThread], latestSequence: 1 }),
    ),
    http.get("/api/threads/:id", () => HttpResponse.json(threadDetail(completedThread))),
  );
  await router.push({ name: "thread", params: { threadId: completedThread.id } });
  await router.isReady();
  const screen = await renderApp();
  const unavailable = screen.getByRole("button", { name: "Review unavailable" });

  await expect.element(screen.getByText(/Git unavailable/u)).toBeVisible();
  await expect.element(unavailable).toHaveAttribute("aria-disabled", "true");
  await expect.element(unavailable).not.toHaveAttribute("disabled");
  unavailable.element().focus();
  await userEvent.keyboard("{Enter}");

  await expect
    .element(screen.getByRole("dialog", { name: "Review changes" }))
    .not.toBeInTheDocument();
  await expect.element(unavailable).toHaveFocus();
});

test("a rejected permission response keeps its card and retries with visible feedback", async () => {
  const needsInputThread = { ...thread, status: "needs-input" as const };
  const interaction = {
    id: PendingInteractionId.make("interaction:browser-permission"),
    projectId: project.id,
    threadId: thread.id,
    turnId: TurnId.make("turn:browser"),
    nodeId: AgentNodeId.make("node:browser-permission"),
    kind: "permission" as const,
    title: "Write implementation file",
    description: "Write /tmp/metaclanker-browser-project/example.ts",
    options: [
      { optionId: "allow", label: "Allow once", kind: "allow-once" as const },
      { optionId: "reject", label: "Reject", kind: "reject-once" as const },
    ],
    status: "pending" as const,
    sequence: 2,
    createdAt: "2026-08-01T00:00:02.000Z",
  };
  const responseStarted = deferred();
  const responseGate = deferred();
  const responseBodies: Array<Record<string, unknown>> = [];
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [needsInputThread], latestSequence: 2 }),
    ),
    http.get("/api/threads/:id", () =>
      HttpResponse.json({
        ...threadDetail(needsInputThread),
        interactions: [interaction],
        latestSequence: 2,
      }),
    ),
    http.post("/api/interactions/:id/respond", async ({ request }) => {
      responseBodies.push((await request.json()) as Record<string, unknown>);
      if (responseBodies.length === 1) {
        responseStarted.resolve();
        await responseGate.promise;
        return HttpResponse.json(
          { message: "Provider rejected permission response" },
          { status: 409 },
        );
      }
      return HttpResponse.json({ ...interaction, status: "resolved", sequence: 3 });
    }),
  );
  await router.push({ name: "thread", params: { threadId: needsInputThread.id } });
  await router.isReady();
  const screen = await renderApp();
  const card = screen.getByRole("region", { name: interaction.title });
  const allow = card.getByRole("button", { name: "Allow once" });

  await allow.click();
  await responseStarted.promise;
  await expect.element(card.getByRole("status")).toHaveTextContent("Sending permission response…");
  await expect.element(allow).toBeDisabled();

  responseGate.resolve();
  await expect
    .element(card.getByRole("alert"))
    .toHaveTextContent(
      "Provider rejected permission response Your permission choice was not sent. Choose an option again.",
    );
  await expect.element(allow).toBeEnabled();

  await allow.click();
  await expect.element(card).not.toBeInTheDocument();
  expect(responseBodies).toHaveLength(2);
  expect(responseBodies[1]?.["commandId"]).toBe(responseBodies[0]?.["commandId"]);
});

test("an active follow-up keeps its draft and exposes stop instead of sending", async () => {
  const cancelRequests: Array<Record<string, unknown>> = [];
  const cancelStarted = deferred();
  const cancelGate = deferred();
  const cancelRetried = deferred();
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [thread], latestSequence: 1 }),
    ),
    http.post("/api/threads/:id/cancel", async ({ request }) => {
      cancelRequests.push((await request.json()) as Record<string, unknown>);
      if (cancelRequests.length === 1) {
        cancelStarted.resolve();
        await cancelGate.promise;
        return HttpResponse.json({ message: "Cancellation was rejected" }, { status: 409 });
      }
      cancelRetried.resolve();
      return HttpResponse.json({ accepted: true });
    }),
  );
  await router.push({ name: "thread", params: { threadId: thread.id } });
  await router.isReady();
  const screen = await renderApp();
  const composer = screen.getByRole("textbox", {
    name: "Ask the agent to build, investigate, or explain…",
  });

  await expect.element(screen.getByRole("button", { name: "Stop turn" })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Send message" }))
    .not.toBeInTheDocument();
  await composer.fill("Keep this while the agent is active");
  await userEvent.keyboard("{Enter}");
  await expect.element(composer).toHaveValue("Keep this while the agent is active");

  await screen.getByRole("button", { name: "Stop turn" }).click();
  await cancelStarted.promise;
  await expect
    .element(screen.getByRole("status", { name: "Stopping turn…" }))
    .toHaveTextContent("Stopping turn…");
  await expect.element(screen.getByRole("button", { name: "Stopping turn…" })).toBeDisabled();

  cancelGate.resolve();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Cancellation was rejected The turn is still active. Try stopping again.");
  await expect.element(screen.getByRole("button", { name: "Stop turn" })).toBeEnabled();

  await screen.getByRole("button", { name: "Stop turn" }).click();
  await cancelRetried.promise;
  eventClient?.send(
    JSON.stringify({
      type: "thread-status",
      sequence: 2,
      threadId: thread.id,
      status: "cancelled",
    }),
  );
  await expect
    .element(screen.getByRole("status", { name: "Thread status: Cancelled" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("status", { name: "Stopping turn…" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Send message" })).toBeVisible();
  expect(cancelRequests).toHaveLength(2);
  expect(cancelRequests[1]?.["commandId"]).toBe(cancelRequests[0]?.["commandId"]);
  await expect.element(composer).toHaveValue("Keep this while the agent is active");
});

test("the project tree shows compact relative thread ages", async () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({
        projects: [project],
        threads: [{ ...thread, updatedAt: threeDaysAgo }],
        latestSequence: 1,
      }),
    ),
  );
  await router.push("/");
  await router.isReady();
  const screen = await renderApp();

  await expect.element(screen.getByText("3d ago", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: `Show or hide conversations in ${project.name}` }))
    .toHaveAttribute("aria-expanded", "true");
});

test("the project disclosure expands from the keyboard", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [thread], latestSequence: 1 }),
    ),
  );
  await router.push("/");
  await router.isReady();
  const screen = await renderApp();
  const toggle = screen.getByRole("button", {
    name: `Show or hide conversations in ${project.name}`,
  });
  const threadLink = screen.getByRole("link", {
    name: new RegExp(`${thread.title}.*${thread.status}`, "i"),
  });

  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");

  await userEvent.keyboard("{Enter}");

  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.element(threadLink).toBeVisible();
});

test("a slower previous thread load cannot replace the latest conversation", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({
        projects: [project],
        threads: [thread, slowerThread],
        latestSequence: 1,
      }),
    ),
  );
  await router.push({ name: "thread", params: { threadId: thread.id } });
  await router.isReady();
  const pinia = createPinia();
  const screen = await renderApp(pinia);
  const workspace = useWorkspaceStore(pinia);
  await expect.element(screen.getByRole("heading", { name: thread.title })).toBeVisible();

  const slowerLoadGate = deferred();
  const slowerRequestStarted = deferred();
  worker.use(
    http.get("/api/threads/:id", async ({ params }) => {
      if (params["id"] === slowerThread.id) {
        slowerRequestStarted.resolve();
        await slowerLoadGate.promise;
        return HttpResponse.json(threadDetail(slowerThread));
      }
      return HttpResponse.json(threadDetail(thread));
    }),
  );

  const slowerLoad = workspace.loadThread(slowerThread.id);
  await slowerRequestStarted.promise;
  const latestLoad = workspace.loadThread(thread.id);
  await latestLoad;
  slowerLoadGate.resolve();
  await slowerLoad;

  await expect.element(screen.getByRole("heading", { name: thread.title })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: slowerThread.title }))
    .not.toBeInTheDocument();
});

test("a required thread snapshot replaces the cursor and resumes the live view", async () => {
  let snapshotRequests = 0;
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({ projects: [project], threads: [thread], latestSequence: 1 }),
    ),
    http.get("/api/threads/:id", () => {
      snapshotRequests += 1;
      return HttpResponse.json({
        ...threadDetail({ ...thread, status: snapshotRequests === 1 ? "running" : "completed" }),
        latestSequence: snapshotRequests === 1 ? 1 : 3,
      });
    }),
  );
  await router.push({ name: "thread", params: { threadId: thread.id } });
  await router.isReady();
  const screen = await renderApp();
  await expect
    .element(screen.getByRole("status", { name: "Thread status: Running" }))
    .toBeVisible();

  eventClient?.send(JSON.stringify({ type: "snapshot-required", reason: "cursor-too-old" }));

  await expect
    .element(screen.getByRole("status", { name: "Thread status: Completed" }))
    .toBeVisible();
  expect(snapshotRequests).toBe(2);
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
  const screen = await renderApp();

  await screen
    .getByRole("textbox", { name: "Ask the agent to build, investigate, or explain…" })
    .fill("Preserve this complete draft");
  await screen.getByLabelText("Provider").selectOptions("claude");
  await screen.getByLabelText("Model").fill("claude-test-model");
  await screen.getByLabelText("Effort").selectOptions("high");
  await screen.getByLabelText("Permissions").selectOptions("read-only");
  await screen.getByRole("button", { name: "Add attachment" }).click();
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

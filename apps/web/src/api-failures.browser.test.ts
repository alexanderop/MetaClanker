import { createPinia } from "pinia";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";

import { ProjectId } from "@metaclanker/contracts/ids";
import { defaultUserSettings } from "@metaclanker/contracts/wire";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import App from "./App.vue";
import { createAppAtomModel } from "./app-atom-model.js";
import { i18n } from "./shared/i18n.js";
import { router } from "./views/router.js";

/** Stands in for prompt text, tool output, or an absolute path in a malformed frame. */
const SECRET = "/Users/alex/private/prompt.txt";

const shellEvents = ws.link("/api/shell/events").addEventListener("connection", ({ client }) => {
  client.send("pong");
});

const worker = setupWorker(
  shellEvents,
  http.post("/api/auth/local", () => HttpResponse.json({ authenticated: true })),
  http.get("/api/settings", () => HttpResponse.json(defaultUserSettings)),
  http.get("/api/providers", () =>
    HttpResponse.json([
      { provider: "codex", status: "ready", reason: null, models: [] },
      { provider: "claude", status: "ready", reason: null, models: [] },
    ]),
  ),
  http.get("/api/shell", () => HttpResponse.json({ projects: [], threads: [], latestSequence: 0 })),
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
  window.localStorage.clear();
});

afterAll(() => worker.stop());

test("a malformed workspace response is reported without echoing the payload", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json({
        projects: [
          {
            id: ProjectId.make("project:leak"),
            name: { secret: SECRET },
            path: SECRET,
            gitBranch: null,
            gitStatus: "unavailable",
            hidden: false,
            order: 0,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        threads: [],
        latestSequence: 0,
      }),
    ),
  );
  await router.push("/");
  await router.isReady();
  const screen = await renderFeature(App, {
    atomModel: createAppAtomModel(),
    global: { plugins: [createPinia(), router, i18n] },
  });

  const alert = screen.getByRole("alert");
  await expect.element(alert).toBeVisible();
  await expect.element(alert).toHaveTextContent("The workspace could not be loaded.");
  expect(document.body.textContent).not.toContain(SECRET);
});

test("a server error response still surfaces the server's own message", async () => {
  worker.use(
    http.get("/api/shell", () =>
      HttpResponse.json(
        { error: { code: "internal", message: "The workspace is temporarily unavailable" } },
        { status: 503 },
      ),
    ),
  );
  await router.push("/");
  await router.isReady();
  const screen = await renderFeature(App, {
    atomModel: createAppAtomModel(),
    global: { plugins: [createPinia(), router, i18n] },
  });

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The workspace is temporarily unavailable");
});

import { createPinia } from "pinia";
import { HttpResponse, http } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-vue";

import { ProjectId } from "@metaclanker/contracts/ids";
import { defaultUserSettings } from "@metaclanker/contracts/wire";

import App from "../../App.vue";
import { i18n } from "../../shared/i18n.js";
import { router } from "../../views/router.js";

const project = {
  id: ProjectId.make("project:browser"),
  name: "Demo workspace",
  path: "/tmp/metaclanker-browser-project",
  gitBranch: "main",
  gitStatus: "clean" as const,
  hidden: false,
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
};

const worker = setupWorker(
  http.post("/api/auth/local", () => HttpResponse.json({ authenticated: true })),
  http.get("/api/shell", () => HttpResponse.json({ projects: [], threads: [], latestSequence: 0 })),
  http.get("/api/settings", () => HttpResponse.json(defaultUserSettings)),
  http.post("/api/projects", () => HttpResponse.json(project)),
);

beforeAll(async () => {
  await worker.start({
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith("/api/")) print.error();
    },
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
});

afterAll(() => worker.stop());

test("a user adds a project through the rendered workspace shell", async () => {
  await router.push("/");
  await router.isReady();
  const screen = await render(App, { global: { plugins: [createPinia(), router, i18n] } });

  await screen.getByRole("button", { name: "Add project" }).click();
  await screen.getByLabelText("Absolute project path").fill(project.path);
  await screen.getByLabelText("Display name").fill(project.name);
  await screen
    .getByRole("dialog", { name: "Open a server-side project" })
    .getByRole("button", { name: "Add project" })
    .click();

  await expect.element(screen.getByText(project.name)).toBeVisible();
});

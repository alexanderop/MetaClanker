import { HttpResponse, http } from "msw";
import { setupWorker } from "msw/browser";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { defineComponent, ref } from "vue";

import { CheckpointId, ThreadId } from "@metaclanker/contracts/ids";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import { createAppAtomModel } from "../../app-atom-model.js";
import { i18n } from "../../shared/i18n.js";
import ReviewPanel from "./ReviewPanel.vue";

const threadId = ThreadId.make("thread:review-browser");
const checkpoint = {
  checkpoint: {
    id: CheckpointId.make("checkpoint:before-turn"),
    createdAt: "2026-08-02T08:00:00.000Z",
    files: [{ path: "src/main.ts", size: 12, kind: "tracked" as const }],
  },
  threadId,
  turnId: null,
  kind: "pre-turn" as const,
};
const review = {
  checkpoints: [checkpoint],
  diff: {
    files: [{ path: "src/main.ts", status: "modified" as const, beforeSize: 10, afterSize: 12 }],
  },
};
const preview = {
  additions: [{ path: "src/restored.ts", size: 8, kind: "tracked" as const }],
  modifications: [{ path: "src/main.ts", size: 10, kind: "tracked" as const }],
  deletions: [],
  includesIgnoredFiles: false,
};
const undoCheckpoint = { ...checkpoint, kind: "undo" as const };

let restoreInputs: unknown[] = [];
const worker = setupWorker(
  http.get("/api/threads/:id/review", () => HttpResponse.json(review)),
  http.post("/api/threads/:id/restore-preview", () => HttpResponse.json(preview)),
  http.post("/api/threads/:id/restore", async ({ request }) => {
    restoreInputs.push(await request.json());
    return HttpResponse.json(undoCheckpoint);
  }),
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
  restoreInputs = [];
});

afterAll(() => worker.stop());

const renderReview = () =>
  renderFeature(ReviewPanel, {
    props: { threadId },
    atomModel: createAppAtomModel(),
    global: { plugins: [i18n] },
  });

test("loads review data and reports a safe initial failure", async () => {
  let releaseReview!: () => void;
  const heldReview = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  worker.use(
    http.get("/api/threads/:id/review", async () => {
      await heldReview;
      return HttpResponse.json(review);
    }),
  );

  const screen = await renderReview();
  await expect.element(screen.getByText("Loading checkpoints…")).toBeVisible();

  releaseReview();
  await expect.element(screen.getByText("src/main.ts")).toBeVisible();
  await screen.unmount();

  worker.use(
    http.get("/api/threads/:id/review", () =>
      HttpResponse.json({ error: { message: "Review is unavailable" } }, { status: 503 }),
    ),
  );
  const failed = await renderReview();
  await expect.element(failed.getByText("Could not load review (HTTP 503).")).toBeVisible();
});

test("keeps stale review data visible when a refresh fails", async () => {
  const screen = await renderReview();
  await expect.element(screen.getByText("src/main.ts")).toBeVisible();
  worker.use(
    http.get("/api/threads/:id/review", () =>
      HttpResponse.json({ error: { message: "offline" } }, { status: 503 }),
    ),
  );

  await screen.getByRole("button", { name: "Refresh review" }).click();
  await expect.element(screen.getByText("Could not load review (HTTP 503).")).toBeVisible();
  await expect.element(screen.getByText("src/main.ts")).toBeVisible();
});

test("explains an empty diff and missing restore checkpoints", async () => {
  worker.use(
    http.get("/api/threads/:id/review", () =>
      HttpResponse.json({ checkpoints: [], diff: { files: [] } }),
    ),
  );
  const screen = await renderReview();

  await expect.element(screen.getByText("No file changes captured.")).toBeVisible();
  await expect.element(screen.getByText("No pre-turn checkpoints are available.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Refresh review" })).toBeEnabled();
});

test("announces destructive-preview loading before exposing confirmation", async () => {
  let releasePreview!: () => void;
  const heldPreview = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  worker.use(
    http.post("/api/threads/:id/restore-preview", async () => {
      await heldPreview;
      return HttpResponse.json(preview);
    }),
  );
  const screen = await renderReview();
  await expect.element(screen.getByText("src/main.ts")).toBeVisible();

  await screen.getByRole("button", { name: /Before turn/ }).click();
  await expect.element(screen.getByText("Preparing destructive preview…")).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Destructive preview" }))
    .not.toBeInTheDocument();

  releasePreview();
  await expect.element(screen.getByRole("heading", { name: "Destructive preview" })).toBeVisible();
});

test("reuses one command identity when an uncertain restore is explicitly retried", async () => {
  let attempt = 0;
  let secondRequestStarted!: () => void;
  let releaseSecondResponse!: () => void;
  const secondStarted = new Promise<void>((resolve) => {
    secondRequestStarted = resolve;
  });
  const secondReleased = new Promise<void>((resolve) => {
    releaseSecondResponse = resolve;
  });
  worker.use(
    http.post("/api/threads/:id/restore", async ({ request }) => {
      restoreInputs.push(await request.json());
      attempt += 1;
      if (attempt === 1) {
        return HttpResponse.json({ error: { message: "uncertain" } }, { status: 503 });
      }
      secondRequestStarted();
      await secondReleased;
      return HttpResponse.json(undoCheckpoint);
    }),
  );
  const screen = await renderReview();
  await expect.element(screen.getByText("src/main.ts")).toBeVisible();

  await screen.getByRole("button", { name: /Before turn/ }).click();
  await expect.element(screen.getByRole("heading", { name: "Destructive preview" })).toBeVisible();
  const restore = screen.getByRole("button", { name: "Restore files" });
  await expect.element(restore).toBeDisabled();
  await screen
    .getByLabelText("I understand this overwrites current files and creates an undo checkpoint.")
    .click();
  await restore.click();

  await expect
    .element(
      screen.getByText(
        "Could not restore files (HTTP 503). The server receipt should be checked before retrying.",
      ),
    )
    .toBeVisible();
  expect(restoreInputs).toHaveLength(1);
  await restore.click();
  await secondStarted;
  expect(restoreInputs).toHaveLength(2);
  expect(restoreInputs[0]).toMatchObject({
    checkpointId: checkpoint.checkpoint.id,
    confirmed: true,
  });
  expect((restoreInputs[0] as { commandId?: unknown }).commandId).toEqual(expect.any(String));
  expect((restoreInputs[1] as { commandId?: unknown }).commandId).toBe(
    (restoreInputs[0] as { commandId?: unknown }).commandId,
  );
  await expect.element(screen.getByRole("button", { name: "Restoring files…" })).toBeDisabled();
  releaseSecondResponse();
  await expect.element(restore).toBeEnabled();
  expect(screen.emitted("restored")).toHaveLength(1);
  expect(screen.emitted("close")).toHaveLength(1);
});

test("refuses to switch checkpoints while a destructive restore is in flight", async () => {
  let restoreStarted!: () => void;
  let releaseRestore!: () => void;
  const started = new Promise<void>((resolve) => {
    restoreStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  const secondCheckpoint = {
    ...checkpoint,
    checkpoint: {
      ...checkpoint.checkpoint,
      id: CheckpointId.make("checkpoint:earlier-turn"),
      createdAt: "2026-08-02T07:00:00.000Z",
    },
  };
  worker.use(
    http.get("/api/threads/:id/review", () =>
      HttpResponse.json({ ...review, checkpoints: [secondCheckpoint, checkpoint] }),
    ),
    http.post("/api/threads/:id/restore", async ({ request }) => {
      restoreInputs.push(await request.json());
      restoreStarted();
      await released;
      return HttpResponse.json(undoCheckpoint);
    }),
  );
  const screen = await renderReview();
  await expect.element(screen.getByText("src/main.ts")).toBeVisible();

  const checkpointButtons = screen.getByRole("button", { name: /Before turn/ });
  await checkpointButtons.first().click();
  await expect.element(screen.getByRole("heading", { name: "Destructive preview" })).toBeVisible();
  await screen
    .getByLabelText("I understand this overwrites current files and creates an undo checkpoint.")
    .click();
  await screen.getByRole("button", { name: "Restore files" }).click();
  await started;

  // Selecting another checkpoint would mint a new CommandId, dispose the restore atom,
  // and interrupt a request the server may already have accepted.
  await expect.element(checkpointButtons.nth(1)).toBeDisabled();

  releaseRestore();
  await expect.element(screen.getByRole("button", { name: "Restore files" })).toBeEnabled();
  expect(restoreInputs).toHaveLength(1);
  expect(screen.emitted("restored")).toHaveLength(1);
});

test("closing the panel interrupts its pending review request without disposing the app model", async () => {
  let requestStarted!: () => void;
  let requestAborted!: () => void;
  let releaseResponse!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    requestAborted = resolve;
  });
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  worker.use(
    http.get("/api/threads/:id/review", async () => {
      requestStarted();
      await responseReleased;
      return HttpResponse.json(review);
    }),
  );
  const Host = defineComponent({
    components: { ReviewPanel },
    setup() {
      const open = ref(true);
      return { open, threadId };
    },
    template: `<ReviewPanel v-if="open" :thread-id="threadId" @close="open = false" />`,
  });
  const observedFetch: typeof globalThis.fetch = (input, init) => {
    init?.signal?.addEventListener(
      "abort",
      () => {
        requestAborted();
        releaseResponse();
      },
      { once: true },
    );
    return globalThis.fetch(input, init);
  };
  const screen = await renderFeature(Host, {
    atomModel: createAppAtomModel({ fetch: observedFetch }),
    global: { plugins: [i18n] },
  });
  await started;

  await screen.getByRole("button", { name: "Close review" }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Review changes" }))
    .not.toBeInTheDocument();
  await aborted;
});

test("the close control emits without dispatching a restore", async () => {
  const screen = await renderReview();
  await screen.getByRole("button", { name: "Close review" }).click();

  expect(screen.emitted("close")).toHaveLength(1);
  expect(restoreInputs).toHaveLength(0);
});

test("the review drawer owns modal keyboard focus and restores its trigger", async () => {
  const Host = defineComponent({
    components: { ReviewPanel },
    setup() {
      const open = ref(false);
      return { open, threadId };
    },
    template: `
      <button type="button" @click="open = true">Open review</button>
      <ReviewPanel v-if="open" :thread-id="threadId" @close="open = false" />
    `,
  });
  const screen = await renderFeature(Host, {
    atomModel: createAppAtomModel(),
    global: { plugins: [i18n] },
  });
  const trigger = screen.getByRole("button", { name: "Open review" });

  await trigger.click();
  const dialog = screen.getByRole("dialog", { name: "Review changes" });
  await expect.element(dialog).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Close review" })).toHaveFocus();

  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

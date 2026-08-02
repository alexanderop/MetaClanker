/* eslint-disable vue/one-component-per-file -- one focused adapter contract owns these tiny probes */
import { AsyncResult, Atom, useAtom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { defineComponent, h, ref } from "vue";
import { expect, test } from "vitest";

import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import { createAppAtomModel, type AppAtomModel } from "../../app-atom-model.js";
import { Client } from "./http.js";
import { useClientAtomModel } from "./provider.js";

const stableState = Atom.make(0);

const statusForExit = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return "success";
  return Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "typed failure";
};

const Identity = (model: AppAtomModel) => {
  const identityAtom = model.client.runtime.atom(
    Effect.gen(function* () {
      const service = yield* Client;
      return service.identity;
    }),
  );
  return defineComponent({
    setup() {
      const result = useAtomValue(() => identityAtom);
      return () => h("span", AsyncResult.isSuccess(result.value) ? "ready" : "waiting");
    },
  });
};

const isolatedContainer = (): HTMLDivElement => {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
};

test("the project wrapper rejects missing model wiring", async () => {
  const MissingProvider = defineComponent({
    setup() {
      useClientAtomModel();
      return () => h("div");
    },
  });

  await expect(
    renderFeature(MissingProvider, { global: { config: { warnHandler: () => undefined } } }),
  ).rejects.toThrow("MetaClanker client atom model was not provided");
});

test("two app registries isolate the same stable atom and Vue refs update", async () => {
  const Counter = defineComponent({
    setup() {
      const [count, setCount] = useAtom(() => stableState);
      return () =>
        h(
          "button",
          { type: "button", onClick: () => setCount(count.value + 1) },
          String(count.value),
        );
    },
  });
  const first = await renderFeature(Counter, {
    container: isolatedContainer(),
    atomModel: createAppAtomModel(),
  });
  const second = await renderFeature(Counter, {
    container: isolatedContainer(),
    atomModel: createAppAtomModel(),
  });

  await first.getByRole("button", { name: "0" }).click();
  await expect.element(first.getByRole("button", { name: "1" })).toBeVisible();
  await expect.element(second.getByRole("button", { name: "0" })).toBeVisible();

  await first.unmount();
  await second.unmount();
});

test("app runtimes own distinct stateful Layer services and finalizers", async () => {
  let firstIdentity: object | undefined;
  let secondIdentity: object | undefined;
  let finalizeFirst!: () => void;
  let finalizeSecond!: () => void;
  const firstFinalized = new Promise<void>((resolve) => {
    finalizeFirst = resolve;
  });
  const secondFinalized = new Promise<void>((resolve) => {
    finalizeSecond = resolve;
  });
  let secondWasFinalized = false;
  void secondFinalized.then(() => {
    secondWasFinalized = true;
  });
  const firstModel = createAppAtomModel({
    onCreate: (service) => {
      firstIdentity = service.identity;
    },
    onFinalize: finalizeFirst,
  });
  const secondModel = createAppAtomModel({
    onCreate: (service) => {
      secondIdentity = service.identity;
    },
    onFinalize: finalizeSecond,
  });
  const first = await renderFeature(Identity(firstModel), {
    container: isolatedContainer(),
    atomModel: firstModel,
  });
  const second = await renderFeature(Identity(secondModel), {
    container: isolatedContainer(),
    atomModel: secondModel,
  });
  await expect.element(first.getByText("ready")).toBeVisible();
  await expect.element(second.getByText("ready")).toBeVisible();
  expect(firstIdentity).toBeDefined();
  expect(secondIdentity).toBeDefined();
  expect(firstIdentity).not.toBe(secondIdentity);

  await first.unmount();
  await firstFinalized;
  expect(secondWasFinalized).toBe(false);
  await expect.element(second.getByText("ready")).toBeVisible();

  await second.unmount();
  await secondFinalized;
});

test("reactive family selection releases the obsolete scoped atom", async () => {
  const model = createAppAtomModel();
  let releaseA!: () => void;
  let releaseB!: () => void;
  const releasedA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const releasedB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  const family = Atom.family((id: "A" | "B") =>
    model.client.runtime.atom(
      Effect.acquireRelease(Effect.succeed(id), () =>
        Effect.sync(id === "A" ? releaseA : releaseB),
      ),
    ),
  );
  const FamilySwitch = defineComponent({
    setup() {
      const selected = ref<"A" | "B">("A");
      const result = useAtomValue(() => family(selected.value));
      return () =>
        h("div", [
          h("span", AsyncResult.isSuccess(result.value) ? result.value.value : "waiting"),
          h("button", { type: "button", onClick: () => (selected.value = "B") }, "Show B"),
        ]);
    },
  });
  const screen = await renderFeature(FamilySwitch, {
    container: isolatedContainer(),
    atomModel: model,
  });
  await expect.element(screen.getByText("A", { exact: true })).toBeVisible();

  await screen.getByRole("button", { name: "Show B" }).click();
  await releasedA;
  await expect.element(screen.getByText("B", { exact: true })).toBeVisible();

  await screen.unmount();
  await releasedB;
});

test("promiseExit preserves outcomes and an aborted waiter cannot outlive teardown", async () => {
  let pendingFinalized!: () => void;
  const finalized = new Promise<void>((resolve) => {
    pendingFinalized = resolve;
  });
  const command = Atom.fn((mode: "success" | "failure" | "pending") => {
    if (mode === "success") return Effect.succeed("done");
    if (mode === "failure") return Effect.fail("typed failure");
    return Effect.never.pipe(Effect.ensuring(Effect.sync(pendingFinalized)));
  });
  const CommandContract = defineComponent({
    setup() {
      const status = ref("idle");
      const controller = ref<AbortController | null>(null);
      const run = useAtomSet(() => command, { mode: "promiseExit" });
      const execute = async (mode: "success" | "failure" | "pending") => {
        controller.value = new AbortController();
        const exit = await run(mode, { signal: controller.value.signal });
        status.value = statusForExit(exit);
      };
      return () =>
        h("div", [
          h("output", status.value),
          h("button", { type: "button", onClick: () => void execute("success") }, "Succeed"),
          h("button", { type: "button", onClick: () => void execute("failure") }, "Fail"),
          h("button", { type: "button", onClick: () => void execute("pending") }, "Wait"),
          h("button", { type: "button", onClick: () => controller.value?.abort() }, "Abort waiter"),
        ]);
    },
  });
  const screen = await renderFeature(CommandContract, {
    container: isolatedContainer(),
    atomModel: createAppAtomModel(),
  });

  await screen.getByRole("button", { name: "Succeed" }).click();
  await expect.element(screen.getByText("success")).toBeVisible();
  await screen.getByRole("button", { name: "Fail" }).click();
  await expect.element(screen.getByText("typed failure")).toBeVisible();
  await screen.getByRole("button", { name: "Wait", exact: true }).click();
  await screen.getByRole("button", { name: "Abort waiter" }).click();
  await expect.element(screen.getByText("interrupted")).toBeVisible();

  await screen.unmount();
  await finalized;
});

test("independent command-family lanes cannot cross-resolve", async () => {
  let resolveFirst!: (value: string) => void;
  let resolveSecond!: (value: string) => void;
  const firstResult = new Promise<string>((resolve) => {
    resolveFirst = resolve;
  });
  const secondResult = new Promise<string>((resolve) => {
    resolveSecond = resolve;
  });
  const commandById = Atom.family((id: "C1" | "C2") =>
    Atom.fn(() => Effect.tryPromise(() => (id === "C1" ? firstResult : secondResult))),
  );
  const CommandLanes = defineComponent({
    setup() {
      const first = ref("idle");
      const second = ref("idle");
      const runFirst = useAtomSet(() => commandById("C1"), { mode: "promiseExit" });
      const runSecond = useAtomSet(() => commandById("C2"), { mode: "promiseExit" });
      const startFirst = async () => {
        first.value = "pending";
        const exit = await runFirst();
        first.value = Exit.isSuccess(exit) ? exit.value : "failed";
      };
      const startSecond = async () => {
        second.value = "pending";
        const exit = await runSecond();
        second.value = Exit.isSuccess(exit) ? exit.value : "failed";
      };
      return () =>
        h("div", [
          h("output", { "aria-label": "First lane" }, first.value),
          h("output", { "aria-label": "Second lane" }, second.value),
          h("button", { type: "button", onClick: () => void startFirst() }, "Start C1"),
          h("button", { type: "button", onClick: () => void startSecond() }, "Start C2"),
        ]);
    },
  });
  const screen = await renderFeature(CommandLanes, {
    container: isolatedContainer(),
    atomModel: createAppAtomModel(),
  });
  await screen.getByRole("button", { name: "Start C1" }).click();
  await screen.getByRole("button", { name: "Start C2" }).click();
  await expect.element(screen.getByLabelText("First lane")).toHaveTextContent("pending");
  await expect.element(screen.getByLabelText("Second lane")).toHaveTextContent("pending");

  resolveSecond("second done");
  await expect.element(screen.getByLabelText("Second lane")).toHaveTextContent("second done");
  await expect.element(screen.getByLabelText("First lane")).toHaveTextContent("pending");

  resolveFirst("first done");
  await expect.element(screen.getByLabelText("First lane")).toHaveTextContent("first done");
  await screen.unmount();
});

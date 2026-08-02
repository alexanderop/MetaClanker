import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";

import { AgentNodeId, ThreadId } from "@metaclanker/contracts/ids";
import type { AgentNode } from "@metaclanker/contracts/wire";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import { createAppAtomModel } from "../../app-atom-model.js";
import { i18n } from "../../shared/i18n.js";
import AgentMap from "./AgentMap.vue";
import AgentTree from "./AgentTree.vue";

const threadId = ThreadId.make("thread:tree-browser");
const node = (id: string, name: string, parentId: AgentNode["parentId"]): AgentNode => ({
  id: AgentNodeId.make(id),
  threadId,
  parentId,
  provider: "codex",
  name,
  model: null,
  state: "running",
  activity: "Working",
  childCount: 0,
  pendingApproval: false,
  changedFileCount: 0,
});

test("tree arrows move between a parent and its first child", async () => {
  const root = node("node:root", "Root agent", null);
  const child = node("node:child", "Child agent", root.id);
  const screen = await renderFeature(AgentTree, {
    atomModel: createAppAtomModel(),
    props: { nodes: [root, child], selectedId: null },
  });

  const rootItem = screen.getByRole("treeitem", { name: /Root agent/u });
  const childItem = screen.getByRole("treeitem", { name: /Child agent/u });
  await rootItem.click();
  await userEvent.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(childItem.element());

  await userEvent.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(rootItem.element());
});

test("the spatial map exposes selection and clears hidden inspector state", async () => {
  const root = node("node:canvas-root", "Root agent", null);
  const child = {
    ...node("node:canvas-child", "Claude reviewer", root.id),
    provider: "claude" as const,
    state: "completed" as const,
    activity: "Review complete",
  };
  const screen = await renderFeature(AgentMap, {
    atomModel: createAppAtomModel(),
    global: { plugins: [i18n] },
    props: { agentNodes: [root, child] },
  });
  const rootNode = screen.getByRole("button", { name: /Root agent/u });

  await rootNode.click();
  await expect.element(rootNode).toHaveAttribute("aria-pressed", "true");
  await expect.element(screen.getByText("Current activity", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Close activity panel" })).toBeVisible();

  await screen.getByLabelText("Provider filter").selectOptions("claude");
  await expect.element(rootNode).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Close activity panel" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: /Claude reviewer/u })).toBeVisible();

  await screen.getByLabelText("State filter").selectOptions("failed");
  await expect
    .element(screen.getByText("Agent activity appears here after the first turn starts."))
    .toBeVisible();
});

test("the accessible hierarchy selects a child from the keyboard", async () => {
  const root = node("node:integrated-root", "Root agent", null);
  const child = node("node:integrated-child", "Child agent", root.id);
  const screen = await renderFeature(AgentMap, {
    atomModel: createAppAtomModel(),
    global: { plugins: [i18n] },
    props: { agentNodes: [root, child] },
  });

  await screen.getByRole("button", { name: "Accessible tree" }).click();
  const rootItem = screen.getByRole("treeitem", { name: /Root agent/u });
  const childItem = screen.getByRole("treeitem", { name: /Child agent/u });
  await rootItem.click();
  await userEvent.keyboard("{ArrowRight}{Enter}");

  expect(document.activeElement).toBe(childItem.element());
  await expect.element(rootItem).toHaveAttribute("aria-selected", "false");
  await expect.element(childItem).toHaveAttribute("aria-selected", "true");
  await expect.element(screen.getByRole("button", { name: "Close activity panel" })).toBeVisible();
});

import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";

import { AgentNodeId, ThreadId } from "@metaclanker/contracts/ids";
import type { AgentNode } from "@metaclanker/contracts/wire";
import { renderFeature } from "@metaclanker/testing/vue/render-feature";

import { createAppAtomModel } from "../../app-atom-model.js";
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

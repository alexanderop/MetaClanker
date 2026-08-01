import { describe, expect, it } from "vitest";

import { AgentNodeId, ThreadId } from "@metaclanker/contracts/ids";
import type { AgentNode } from "@metaclanker/contracts/wire";

import { createDeterministicLayout, reduceAgentGraph } from "./graph.js";

const threadId = ThreadId.make("graph-thread");
const rootId = AgentNodeId.make("root");
const childId = AgentNodeId.make("child");

const node = (id: AgentNodeId, parentId: AgentNodeId | null): AgentNode => ({
  id,
  threadId,
  parentId,
  name: id,
  provider: "codex",
  model: null,
  state: "running",
  activity: "Working",
  childCount: 0,
  pendingApproval: false,
  changedFileCount: 0,
});

describe("agent graph", () => {
  it("derives hierarchy counts and preserves activity when rediscovering a node", () => {
    const empty = { threadId, nodes: {} };
    const withRoot = reduceAgentGraph(empty, {
      type: "agent-discovered",
      nodeId: rootId,
      parentId: null,
      name: "Root",
      provider: "codex",
      model: null,
    });
    const runningRoot = reduceAgentGraph(withRoot, {
      type: "agent-status-changed",
      nodeId: rootId,
      state: "running",
      activity: "Inspecting files",
    });
    const withChild = reduceAgentGraph(runningRoot, {
      type: "agent-discovered",
      nodeId: childId,
      parentId: rootId,
      name: "Child",
      provider: "codex",
      model: "test-model",
    });
    const rediscovered = reduceAgentGraph(withChild, {
      type: "agent-discovered",
      nodeId: rootId,
      parentId: null,
      name: "Renamed root",
      provider: "codex",
      model: null,
    });

    expect(rediscovered.nodes[rootId]).toMatchObject({
      name: "Renamed root",
      state: "running",
      activity: "Inspecting files",
      childCount: 1,
    });
    expect(rediscovered.nodes[childId]).toMatchObject({ parentId: rootId, model: "test-model" });
  });

  it("ignores orphan updates and clamps attributed file counts", () => {
    const state = { threadId, nodes: { [rootId]: node(rootId, null) } };
    const orphan = reduceAgentGraph(state, {
      type: "agent-discovered",
      nodeId: childId,
      parentId: AgentNodeId.make("missing"),
      name: "Orphan",
      provider: "claude",
      model: null,
    });
    const approved = reduceAgentGraph(state, {
      type: "agent-approval-changed",
      nodeId: rootId,
      pending: true,
    });
    const changed = reduceAgentGraph(approved, {
      type: "agent-files-changed",
      nodeId: rootId,
      count: -4,
    });

    expect(orphan).toBe(state);
    expect(changed.nodes[rootId]).toMatchObject({ pendingApproval: true, changedFileCount: 0 });
  });

  it("places children in deterministic depth lanes", () => {
    expect(createDeterministicLayout([node(childId, rootId), node(rootId, null)])).toEqual([
      { id: childId, x: 320, y: 0 },
      { id: rootId, x: 0, y: 0 },
    ]);
  });
});

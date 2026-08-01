import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { AgentNodeId, ThreadId } from "@metaclanker/contracts/ids";
import type { AgentNode } from "@metaclanker/contracts/wire";

import { createDeterministicLayout } from "./graph.js";

const threadId = ThreadId.make("property-thread");

test.prop([fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 40 })])(
  "a flat agent graph always receives a deterministic, collision-free layout",
  (identifiers) => {
    const nodes: AgentNode[] = identifiers.map((identifier) => ({
      id: AgentNodeId.make(identifier),
      threadId,
      parentId: null,
      name: identifier,
      provider: "codex",
      model: null,
      state: "running",
      activity: "Working",
      childCount: 0,
      pendingApproval: false,
      changedFileCount: 0,
    }));

    const first = createDeterministicLayout(nodes);
    const second = createDeterministicLayout(nodes.toReversed());

    expect(first).toEqual(second);
    expect(new Set(first.map((point) => `${point.x}:${point.y}`)).size).toBe(first.length);
    expect(first.map((point) => point.id).toSorted()).toEqual(identifiers.toSorted());
  },
);

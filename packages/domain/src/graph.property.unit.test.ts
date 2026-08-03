import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { AgentNodeId, ThreadId } from "@metaclanker/contracts/ids";
import type { AgentNode } from "@metaclanker/contracts/wire";

import { createDeterministicLayout } from "./graph.js";

const threadId = ThreadId.make("property-thread");

const node = (identifier: string, parentId: string | null): AgentNode => ({
  id: AgentNodeId.make(identifier),
  threadId,
  parentId: parentId === null ? null : AgentNodeId.make(parentId),
  name: identifier,
  provider: "codex",
  model: null,
  state: "running",
  activity: "Working",
  childCount: 0,
  pendingApproval: false,
  changedFileCount: 0,
});

/**
 * Generates a forest, then rewires some parents to identifiers that are not in the set.
 * A generator that only ever produced a flat single-root graph made the collision-free
 * assertion below vacuous: orphans and extra roots are exactly what used to collide.
 */
const graphs = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 25 }).chain((identifiers) =>
  fc
    .tuple(
      // Each node points at an earlier node, at nothing, or at an absent parent.
      fc.array(fc.option(fc.nat(), { nil: null }), {
        minLength: identifiers.length,
        maxLength: identifiers.length,
      }),
      fc.array(fc.boolean(), {
        minLength: identifiers.length,
        maxLength: identifiers.length,
      }),
    )
    .map(([parents, orphaned]) =>
      identifiers.map((identifier, index) => {
        if (orphaned[index] === true) return node(identifier, `absent:${String(index)}`);
        const choice = parents[index];
        if (choice === null || choice === undefined || index === 0) return node(identifier, null);
        return node(identifier, identifiers[choice % index] ?? null);
      }),
    ),
);

test.prop([graphs])("every agent receives one deterministic, collision-free position", (nodes) => {
  const first = createDeterministicLayout(nodes);
  const second = createDeterministicLayout(nodes.toReversed());

  expect(first).toEqual(second);
  expect(first.map((point) => point.id).toSorted()).toEqual(nodes.map((n) => n.id).toSorted());
  expect(new Set(first.map((point) => `${point.x}:${point.y}`)).size).toBe(first.length);
});

test.prop([fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 12 })])(
  "places a parent cycle instead of dropping every node in it",
  (identifiers) => {
    // Nobody has a reachable root: each node's parent is the next one round the ring.
    const cycle = identifiers.map((identifier, index) =>
      node(identifier, identifiers[(index + 1) % identifiers.length] ?? null),
    );

    const points = createDeterministicLayout(cycle);

    expect(points).toHaveLength(cycle.length);
    expect(new Set(points.map((point) => `${point.x}:${point.y}`)).size).toBe(points.length);
  },
);

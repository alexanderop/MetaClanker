import type { AgentNodeId, ThreadId } from "@metaclanker/contracts/ids";
import type { AgentNode, AgentState, Provider } from "@metaclanker/contracts/wire";

export interface AgentGraphSnapshot {
  readonly threadId: ThreadId;
  readonly nodes: Readonly<Record<string, AgentNode>>;
}

export type AgentGraphEvent =
  | {
      readonly type: "agent-discovered";
      readonly nodeId: AgentNodeId;
      readonly parentId: AgentNodeId | null;
      readonly name: string;
      readonly provider: Provider;
      readonly model: string | null;
    }
  | {
      readonly type: "agent-status-changed";
      readonly nodeId: AgentNodeId;
      readonly state: AgentState;
      readonly activity: string;
    }
  | {
      readonly type: "agent-approval-changed";
      readonly nodeId: AgentNodeId;
      readonly pending: boolean;
    }
  | {
      readonly type: "agent-files-changed";
      readonly nodeId: AgentNodeId;
      readonly count: number;
    };

const updateChildCounts = (nodes: Readonly<Record<string, AgentNode>>) => {
  const counts = new Map<string, number>();

  for (const node of Object.values(nodes)) {
    if (node.parentId !== null) {
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
  }

  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => [id, { ...node, childCount: counts.get(id) ?? 0 }]),
  );
};

export const reduceAgentGraph = (
  state: AgentGraphSnapshot,
  event: AgentGraphEvent,
): AgentGraphSnapshot => {
  if (event.type === "agent-discovered") {
    if (event.parentId !== null && state.nodes[event.parentId] === undefined) {
      return state;
    }

    const existing = state.nodes[event.nodeId];
    const node: AgentNode = {
      id: event.nodeId,
      threadId: state.threadId,
      parentId: event.parentId,
      name: event.name,
      provider: event.provider,
      model: event.model,
      state: existing?.state ?? "starting",
      activity: existing?.activity ?? "Starting",
      childCount: existing?.childCount ?? 0,
      pendingApproval: existing?.pendingApproval ?? false,
      changedFileCount: existing?.changedFileCount ?? 0,
    };

    return { ...state, nodes: updateChildCounts({ ...state.nodes, [event.nodeId]: node }) };
  }

  const current = state.nodes[event.nodeId];
  if (current === undefined) {
    return state;
  }

  if (event.type === "agent-status-changed") {
    return {
      ...state,
      nodes: {
        ...state.nodes,
        [event.nodeId]: { ...current, state: event.state, activity: event.activity },
      },
    };
  }

  if (event.type === "agent-approval-changed") {
    return {
      ...state,
      nodes: {
        ...state.nodes,
        [event.nodeId]: { ...current, pendingApproval: event.pending },
      },
    };
  }

  return {
    ...state,
    nodes: {
      ...state.nodes,
      [event.nodeId]: { ...current, changedFileCount: Math.max(0, event.count) },
    },
  };
};

export interface LayoutPoint {
  readonly id: AgentNodeId;
  readonly x: number;
  readonly y: number;
}

/**
 * Every node receives exactly one position, and no two share one. A node whose parent
 * was filtered out of `nodes` is a root of what remains: treating only `parentId === null`
 * as a root left orphans — and every member of a parent cycle — unplaced and stacked.
 */
export const createDeterministicLayout = (
  nodes: ReadonlyArray<AgentNode>,
): ReadonlyArray<LayoutPoint> => {
  const present = new Set(nodes.map((node) => node.id));
  const byParent = new Map<string | null, AgentNode[]>();
  for (const node of nodes) {
    const key = node.parentId !== null && present.has(node.parentId) ? node.parentId : null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(node);
    byParent.set(key, siblings);
  }

  for (const [parentId, siblings] of byParent) {
    byParent.set(
      parentId,
      siblings.toSorted((left, right) => left.id.localeCompare(right.id)),
    );
  }

  const points: LayoutPoint[] = [];
  const placed = new Set<string>();
  const visit = (node: AgentNode, depth: number, lane: number): number => {
    if (placed.has(node.id)) return lane;
    placed.add(node.id);
    const children = byParent.get(node.id) ?? [];
    let nextLane = lane;
    for (const child of children) {
      nextLane = visit(child, depth + 1, nextLane);
    }

    const ownLane = nextLane === lane ? nextLane : lane + (nextLane - lane - 1) / 2;
    points.push({ id: node.id, x: depth * 320, y: ownLane * 180 });
    return nextLane === lane ? nextLane + 1 : nextLane;
  };

  // The lane cursor carries across roots; recounting placed roots let a second tree
  // start inside the lanes the first one had already spent on its descendants.
  let lane = 0;
  for (const root of byParent.get(null) ?? []) {
    lane = visit(root, 0, lane);
  }
  // Anything still unplaced belongs to a parent cycle among the remaining nodes.
  for (const node of nodes) {
    lane = visit(node, 0, lane);
  }

  return points.toSorted((left, right) => left.id.localeCompare(right.id));
};

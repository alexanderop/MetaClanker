<script setup lang="ts">
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import {
  MarkerType,
  VueFlow,
  useVueFlow,
  type Edge,
  type Node,
  type NodeMouseEvent,
} from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { computed, ref, watchEffect } from "vue";

import type { AgentNode, AgentState, Provider } from "@metaclanker/contracts/wire";
import { createDeterministicLayout } from "@metaclanker/domain/graph";

import AgentTree from "./AgentTree.vue";

const props = defineProps<{ agentNodes: ReadonlyArray<AgentNode> }>();
const mode = ref<"canvas" | "tree">("canvas");
const provider = ref<Provider | "all">("all");
const state = ref<AgentState | "all">("all");
const selectedId = ref<string | null>(null);
const flowNodes = ref<Node[]>([]);
const flowEdges = ref<Edge[]>([]);
const { fitView } = useVueFlow();

const filteredNodes = computed(() =>
  props.agentNodes.filter(
    (node) =>
      (provider.value === "all" || node.provider === provider.value) &&
      (state.value === "all" || node.state === state.value),
  ),
);

const selected = computed(
  () => props.agentNodes.find((node) => node.id === selectedId.value) ?? null,
);

watchEffect(() => {
  const visible = filteredNodes.value;
  const visibleIds = new Set(visible.map((node) => node.id));
  const positions = new Map(createDeterministicLayout(visible).map((point) => [point.id, point]));
  flowNodes.value = visible.map((node) => ({
    id: node.id,
    type: "agent",
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: node,
  }));
  flowEdges.value = visible.flatMap((node) =>
    node.parentId !== null && visibleIds.has(node.parentId)
      ? [
          {
            id: `${node.parentId}:${node.id}`,
            source: node.parentId,
            target: node.id,
            markerEnd: MarkerType.ArrowClosed,
          },
        ]
      : [],
  );
});

const selectNode = (node: AgentNode): void => {
  selectedId.value = node.id;
};

const onNodeClick = (event: NodeMouseEvent): void => {
  const node = props.agentNodes.find((candidate) => candidate.id === event.node.id);
  if (node !== undefined) selectNode(node);
};
</script>

<template>
  <section class="map-surface" aria-labelledby="agent-map-title">
    <div class="map-toolbar">
      <div>
        <p class="eyebrow">Live hierarchy</p>
        <h2 id="agent-map-title">{{ $t("map.title") }}</h2>
      </div>
      <div class="map-filters">
        <label>
          <span class="sr-only">Provider filter</span>
          <select v-model="provider">
            <option value="all">{{ $t("map.allProviders") }}</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          <span class="sr-only">State filter</span>
          <select v-model="state">
            <option value="all">{{ $t("map.allStates") }}</option>
            <option value="running">Running</option>
            <option value="needs-input">Needs input</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <div class="view-toggle" role="group" aria-label="Map representation">
          <button type="button" :aria-pressed="mode === 'canvas'" @click="mode = 'canvas'">
            {{ $t("map.canvas") }}
          </button>
          <button type="button" :aria-pressed="mode === 'tree'" @click="mode = 'tree'">
            {{ $t("map.tree") }}
          </button>
        </div>
        <button class="button secondary" type="button" @click="fitView({ padding: 0.24 })">
          {{ $t("map.fit") }}
        </button>
      </div>
    </div>

    <div v-if="filteredNodes.length === 0" class="map-empty">
      <span aria-hidden="true">⌘</span>
      <p>{{ $t("map.empty") }}</p>
    </div>

    <div v-else class="map-body">
      <VueFlow
        v-if="mode === 'canvas'"
        class="agent-flow"
        :nodes="flowNodes"
        :edges="flowEdges"
        :min-zoom="0.3"
        :max-zoom="1.8"
        fit-view-on-init
        @node-click="onNodeClick"
      >
        <template #node-agent="{ data }">
          <button
            class="agent-node"
            type="button"
            :class="{ selected: data.id === selectedId }"
            @click="selectNode(data)"
          >
            <span class="agent-node-topline">
              <span class="tree-provider" :data-provider="data.provider" aria-hidden="true">
                {{ data.provider === "codex" ? "C" : "A" }}
              </span>
              <span class="status-badge" :data-status="data.state"
                ><span aria-hidden="true" />{{ data.state }}</span
              >
            </span>
            <strong>{{ data.name }}</strong>
            <small>{{ data.activity }}</small>
            <span class="agent-node-metrics">
              <span>{{ data.childCount }} children</span>
              <span v-if="data.pendingApproval">Needs approval</span>
              <span v-if="data.changedFileCount">{{ data.changedFileCount }} files</span>
            </span>
          </button>
        </template>
        <Background pattern-color="var(--color-border-subtle)" :gap="24" />
        <MiniMap pannable zoomable />
        <Controls />
      </VueFlow>

      <AgentTree v-else :nodes="filteredNodes" :selected-id="selectedId" @select="selectNode" />

      <aside v-if="selected" class="node-inspector" aria-live="polite">
        <div class="node-inspector-heading">
          <span class="tree-provider" :data-provider="selected.provider" aria-hidden="true">
            {{ selected.provider === "codex" ? "C" : "A" }}
          </span>
          <div>
            <strong>{{ selected.name }}</strong
            ><small>{{ selected.provider }} · {{ selected.model ?? "default model" }}</small>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close activity panel"
            @click="selectedId = null"
          >
            ×
          </button>
        </div>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{{ selected.state }}</dd>
          </div>
          <div>
            <dt>Current activity</dt>
            <dd>{{ selected.activity }}</dd>
          </div>
          <div>
            <dt>Changed files</dt>
            <dd>{{ selected.changedFileCount }}</dd>
          </div>
        </dl>
      </aside>
    </div>
  </section>
</template>

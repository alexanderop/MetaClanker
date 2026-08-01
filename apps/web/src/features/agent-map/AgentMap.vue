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
import { Button } from "../../ui/button/index.js";
import { EmptyState } from "../../ui/empty-state/index.js";
import { Eyebrow } from "../../ui/eyebrow/index.js";
import { NativeSelect } from "../../ui/native-select/index.js";
import { ProviderMark } from "../../ui/provider-mark/index.js";
import { StatusBadge } from "../../ui/status-badge/index.js";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group/index.js";

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

const inspectorRows = computed(() => [
  { label: "Status", value: selected.value?.state ?? "" },
  { label: "Current activity", value: selected.value?.activity ?? "" },
  { label: "Changed files", value: String(selected.value?.changedFileCount ?? 0) },
]);

const filterClass = "min-h-[2.15rem] pr-[1.7rem] text-[0.65rem]";
const inspectorRowClass =
  "grid grid-cols-[6rem_1fr] gap-2 border-t border-border-subtle pt-[0.55rem] text-[0.65rem]";

const selectNode = (node: AgentNode): void => {
  selectedId.value = node.id;
};

const onNodeClick = (event: NodeMouseEvent): void => {
  const node = props.agentNodes.find((candidate) => candidate.id === event.node.id);
  if (node !== undefined) selectNode(node);
};
</script>

<template>
  <section
    class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-canvas"
    aria-labelledby="agent-map-title"
  >
    <div
      class="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-[0.85rem] max-narrow:flex-col max-narrow:items-stretch"
    >
      <div>
        <Eyebrow>Live hierarchy</Eyebrow>
        <h2 id="agent-map-title" class="mt-[0.1rem] mb-0 text-base">{{ $t("map.title") }}</h2>
      </div>
      <div class="flex items-center gap-[0.45rem] max-narrow:flex-wrap max-narrow:items-stretch">
        <label>
          <span class="sr-only">Provider filter</span>
          <NativeSelect v-model="provider" size="sm" :class="filterClass">
            <option value="all">{{ $t("map.allProviders") }}</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </NativeSelect>
        </label>
        <label>
          <span class="sr-only">State filter</span>
          <NativeSelect v-model="state" size="sm" :class="filterClass">
            <option value="all">{{ $t("map.allStates") }}</option>
            <option value="running">Running</option>
            <option value="needs-input">Needs input</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </NativeSelect>
        </label>
        <ToggleGroup v-model="mode" aria-label="Map representation">
          <ToggleGroupItem value="canvas">{{ $t("map.canvas") }}</ToggleGroupItem>
          <ToggleGroupItem value="tree">{{ $t("map.tree") }}</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="secondary" type="button" @click="fitView({ padding: 0.24 })">
          {{ $t("map.fit") }}
        </Button>
      </div>
    </div>

    <EmptyState v-if="filteredNodes.length === 0" glyph="⌘">
      <p>{{ $t("map.empty") }}</p>
    </EmptyState>

    <div v-else class="relative min-h-0">
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
            class="grid w-60 cursor-pointer gap-[0.55rem] rounded-lg border border-border bg-surface p-[0.8rem] text-left text-text shadow-[var(--shadow-soft)] hover:border-accent-strong hover:shadow-[var(--shadow-ring),var(--shadow-soft)]"
            type="button"
            :class="
              data.id === selectedId
                ? 'border-accent-strong shadow-[var(--shadow-ring),var(--shadow-soft)]'
                : undefined
            "
            @click="selectNode(data)"
          >
            <span class="flex items-center justify-between gap-[0.4rem]">
              <ProviderMark :provider="data.provider" size="sm">
                {{ data.provider === "codex" ? "C" : "A" }}
              </ProviderMark>
              <StatusBadge :status="data.state">{{ data.state }}</StatusBadge>
            </span>
            <strong class="text-[0.78rem]">{{ data.name }}</strong>
            <small
              class="overflow-hidden text-[0.65rem] text-ellipsis whitespace-nowrap text-text-muted"
            >
              {{ data.activity }}
            </small>
            <span
              class="flex items-center justify-start gap-[0.4rem] text-[0.55rem] text-text-muted"
            >
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

      <aside
        v-if="selected"
        class="absolute top-4 right-4 z-[5] w-[min(20rem,calc(100%-2rem))] rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] p-[0.85rem] shadow-[var(--shadow-popover)] backdrop-blur-[14px]"
        aria-live="polite"
      >
        <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.65rem]">
          <ProviderMark :provider="selected.provider" size="sm">
            {{ selected.provider === "codex" ? "C" : "A" }}
          </ProviderMark>
          <div>
            <strong class="block text-[0.75rem]">{{ selected.name }}</strong
            ><small class="mt-[0.15rem] block text-[0.6rem] text-text-muted capitalize"
              >{{ selected.provider }} · {{ selected.model ?? "default model" }}</small
            >
          </div>
          <Button
            variant="outline"
            size="icon"
            type="button"
            aria-label="Close activity panel"
            @click="selectedId = null"
          >
            ×
          </Button>
        </div>
        <dl class="m-0 mt-4 grid gap-[0.55rem]">
          <div v-for="row in inspectorRows" :key="row.label" :class="inspectorRowClass">
            <dt class="text-text-muted">{{ row.label }}</dt>
            <dd class="m-0 capitalize">{{ row.value }}</dd>
          </div>
        </dl>
      </aside>
    </div>
  </section>
</template>

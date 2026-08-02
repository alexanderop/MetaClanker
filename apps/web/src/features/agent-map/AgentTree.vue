<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";

import type { AgentNode, Provider } from "@metaclanker/contracts/wire";

import { ProviderMark } from "../../ui/provider-mark/index.js";
import { StatusBadge } from "../../ui/status-badge/index.js";

const props = defineProps<{
  nodes: ReadonlyArray<AgentNode>;
  selectedId: string | null;
}>();

const emit = defineEmits<{ select: [node: AgentNode] }>();
const treeItems = useTemplateRef<HTMLButtonElement[]>("treeItems");
const focusedId = ref<string | null>(null);

interface TreeEntry {
  readonly node: AgentNode;
  readonly depth: number;
}

const entries = computed(() => {
  const byParent = new Map<string | null, AgentNode[]>();
  for (const node of props.nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  for (const [parentId, siblings] of byParent)
    byParent.set(
      parentId,
      siblings.toSorted((left, right) => left.name.localeCompare(right.name)),
    );
  const result: TreeEntry[] = [];
  const append = (parentId: string | null, depth: number): void => {
    for (const node of byParent.get(parentId) ?? []) {
      result.push({ node, depth });
      append(node.id, depth + 1);
    }
  };
  append(null, 1);
  return result;
});

const focusedIndex = computed(() => {
  const index = entries.value.findIndex((entry) => entry.node.id === focusedId.value);
  return index < 0 ? 0 : index;
});

watch(
  entries,
  (next) => {
    if (next.length === 0) {
      focusedId.value = null;
      return;
    }
    if (next.some((entry) => entry.node.id === focusedId.value)) return;
    focusedId.value =
      next.find((entry) => entry.node.id === props.selectedId)?.node.id ?? next[0]?.node.id ?? null;
  },
  { immediate: true },
);

const focusEntry = (index: number): void => {
  if (entries.value.length === 0) return;
  const nextIndex = Math.max(0, Math.min(entries.value.length - 1, index));
  focusedId.value = entries.value[nextIndex]?.node.id ?? null;
  void nextTick(() => {
    treeItems.value?.[nextIndex]?.focus();
  });
};

const onKeydown = (event: KeyboardEvent, entry: TreeEntry, index: number): void => {
  if (event.key === "ArrowDown") focusEntry(index + 1);
  else if (event.key === "ArrowUp") focusEntry(index - 1);
  else if (event.key === "Home") focusEntry(0);
  else if (event.key === "End") focusEntry(entries.value.length - 1);
  else if (event.key === "ArrowRight") {
    const childIndex = entries.value.findIndex(
      (candidate) => candidate.node.parentId === entry.node.id,
    );
    if (childIndex < 0) return;
    focusEntry(childIndex);
  } else if (event.key === "ArrowLeft") {
    if (entry.node.parentId === null) return;
    const parentIndex = entries.value.findIndex(
      (candidate) => candidate.node.id === entry.node.parentId,
    );
    if (parentIndex < 0) return;
    focusEntry(parentIndex);
  } else if (event.key === "Enter" || event.key === " ") emit("select", entry.node);
  else return;
  event.preventDefault();
};

const providerLetter = (provider: Provider) => (provider === "codex" ? "C" : "A");
</script>

<template>
  <div class="h-full overflow-auto p-4" role="tree" aria-label="Agent hierarchy">
    <button
      v-for="(entry, index) in entries"
      ref="treeItems"
      :key="entry.node.id"
      role="treeitem"
      type="button"
      class="grid w-full min-h-13 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-border-subtle bg-transparent text-left text-text hover:bg-surface aria-selected:bg-surface"
      :aria-level="entry.depth"
      :aria-selected="entry.node.id === selectedId"
      :tabindex="index === focusedIndex ? 0 : -1"
      :style="{ paddingInlineStart: `${entry.depth * 1.25}rem` }"
      @click="$emit('select', entry.node)"
      @focus="focusedId = entry.node.id"
      @keydown="onKeydown($event, entry, index)"
    >
      <ProviderMark :provider="entry.node.provider" size="sm">
        {{ providerLetter(entry.node.provider) }}
      </ProviderMark>
      <span
        ><strong class="block text-sm">{{ entry.node.name }}</strong
        ><small class="mt-0.5 block text-xs text-text-muted">{{ entry.node.activity }}</small></span
      >
      <StatusBadge :status="entry.node.state">{{ entry.node.state }}</StatusBadge>
    </button>
  </div>
</template>

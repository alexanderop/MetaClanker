<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";

import type { AgentNode, Provider } from "@metaclanker/contracts/wire";

const props = defineProps<{
  nodes: ReadonlyArray<AgentNode>;
  selectedId: string | null;
}>();

const emit = defineEmits<{ select: [node: AgentNode] }>();
const treeItems = useTemplateRef<HTMLButtonElement[]>("treeItems");
const focusedIndex = ref(0);

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

const focusEntry = (index: number): void => {
  focusedIndex.value = Math.max(0, Math.min(entries.value.length - 1, index));
  void nextTick(() => {
    treeItems.value?.[focusedIndex.value]?.focus();
  });
};

const onKeydown = (event: KeyboardEvent, entry: TreeEntry, index: number): void => {
  if (event.key === "ArrowDown") focusEntry(index + 1);
  else if (event.key === "ArrowUp") focusEntry(index - 1);
  else if (event.key === "Home") focusEntry(0);
  else if (event.key === "End") focusEntry(entries.value.length - 1);
  else if (event.key === "Enter" || event.key === " ") emit("select", entry.node);
  else return;
  event.preventDefault();
};

const providerLetter = (provider: Provider) => (provider === "codex" ? "C" : "A");
</script>

<template>
  <div class="agent-tree" role="tree" aria-label="Agent hierarchy">
    <button
      v-for="(entry, index) in entries"
      ref="treeItems"
      :key="entry.node.id"
      role="treeitem"
      type="button"
      :aria-level="entry.depth"
      :aria-selected="entry.node.id === selectedId"
      :tabindex="index === focusedIndex ? 0 : -1"
      :style="{ paddingInlineStart: `${entry.depth * 1.25}rem` }"
      @click="$emit('select', entry.node)"
      @keydown="onKeydown($event, entry, index)"
    >
      <span class="tree-provider" :data-provider="entry.node.provider" aria-hidden="true">
        {{ providerLetter(entry.node.provider) }}
      </span>
      <span
        ><strong>{{ entry.node.name }}</strong
        ><small>{{ entry.node.activity }}</small></span
      >
      <span class="status-badge" :data-status="entry.node.state">
        <span aria-hidden="true" />{{ entry.node.state }}
      </span>
    </button>
  </div>
</template>

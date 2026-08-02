<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { ToggleGroupItem } from "reka-ui";

import { cn } from "../utils.js";

// reka contributes the roving tabindex and keeps `aria-pressed` in sync; the
// selected look is driven off its `data-state` rather than off our own bookkeeping.
const props = defineProps<{ value: string; class?: HTMLAttributes["class"] }>();
</script>

<template>
  <ToggleGroupItem
    data-slot="toggle-group-item"
    :value="value"
    :class="
      cn(
        'inline-flex min-h-7.5 cursor-pointer items-center gap-1.5 rounded-xs border-0 bg-transparent px-2.5 py-1.5 text-xs text-text-muted data-[state=on]:bg-surface data-[state=on]:text-text data-[state=on]:shadow-inset',
        props.class,
      )
    "
  >
    <slot />
  </ToggleGroupItem>
</template>

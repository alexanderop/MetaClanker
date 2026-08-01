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
        'inline-flex min-h-[1.9rem] cursor-pointer items-center gap-[0.35rem] rounded-xs border-0 bg-transparent px-[0.6rem] py-[0.35rem] text-[0.65rem] text-text-muted data-[state=on]:bg-surface data-[state=on]:text-text data-[state=on]:shadow-inset',
        props.class,
      )
    "
  >
    <slot />
  </ToggleGroupItem>
</template>

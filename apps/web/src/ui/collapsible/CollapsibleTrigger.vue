<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CollapsibleTrigger } from "reka-ui";

import { cn } from "../utils.js";

// reka owns `aria-expanded` and `aria-controls`; the caret rotation is ours and
// reads off the `data-state` it publishes.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <CollapsibleTrigger
    data-slot="collapsible-trigger"
    :class="cn('cursor-pointer border-0 bg-transparent p-0', props.class)"
  >
    <slot />
  </CollapsibleTrigger>
</template>

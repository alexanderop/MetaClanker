<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

// A wrapping <label>: the control is its own accessible name, so no id/for pair can
// drift. Callers place the caption, the control, and any hint inside the default slot.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <label data-slot="field" :class="cn('grid gap-[0.35rem] text-[0.72rem] font-[650]', props.class)">
    <slot />
  </label>
</template>

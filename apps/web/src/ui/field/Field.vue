<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

// A wrapping <label>: the control is its own accessible name, so no id/for pair can
// drift. Callers place the caption, the control, and any hint inside the default slot.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <label data-slot="field" :class="cn('grid gap-1.5 text-sm font-semibold', props.class)">
    <slot />
  </label>
</template>

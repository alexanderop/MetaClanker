<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div data-slot="dialog-footer" :class="cn('flex justify-end gap-2', props.class)">
    <slot />
  </div>
</template>

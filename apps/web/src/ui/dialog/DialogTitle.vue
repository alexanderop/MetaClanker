<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { DialogTitle } from "reka-ui";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <DialogTitle
    data-slot="dialog-title"
    :class="cn('mt-1 mb-0 text-2xl tracking-tighter', props.class)"
  >
    <slot />
  </DialogTitle>
</template>

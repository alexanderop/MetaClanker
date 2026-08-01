<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { DialogTitle } from "reka-ui";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <DialogTitle
    data-slot="dialog-title"
    :class="cn('mt-[0.2rem] mb-0 text-[1.15rem] tracking-[-0.025em]', props.class)"
  >
    <slot />
  </DialogTitle>
</template>

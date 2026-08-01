<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { DialogDescription } from "reka-ui";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <DialogDescription
    data-slot="dialog-description"
    :class="cn('m-0 text-[0.75rem] leading-relaxed text-text-muted', props.class)"
  >
    <slot />
  </DialogDescription>
</template>

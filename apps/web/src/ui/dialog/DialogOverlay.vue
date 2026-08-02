<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { DialogOverlay } from "reka-ui";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    :class="cn('fixed inset-0 z-50 bg-scrim backdrop-blur-xs', props.class)"
  />
</template>

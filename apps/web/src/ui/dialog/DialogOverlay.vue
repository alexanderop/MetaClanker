<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { DialogOverlay } from "reka-ui";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    :class="cn('fixed inset-0 z-50 bg-[rgb(5_8_4/0.62)] backdrop-blur-[3px]', props.class)"
  />
</template>

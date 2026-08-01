<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <small
    data-slot="field-hint"
    :class="cn('text-[0.6rem] font-normal text-text-muted', props.class)"
  >
    <slot />
  </small>
</template>

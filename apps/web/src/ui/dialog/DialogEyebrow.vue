<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <p
    data-slot="dialog-eyebrow"
    :class="
      cn(
        'm-0 text-[0.67rem] font-[750] tracking-[0.12em] text-accent-strong uppercase',
        props.class,
      )
    "
  >
    <slot />
  </p>
</template>

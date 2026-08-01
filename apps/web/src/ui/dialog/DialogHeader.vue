<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div
    data-slot="dialog-header"
    :class="
      cn(
        'flex items-start justify-between gap-4 has-data-[slot=dialog-close]:grid-cols-[1fr_auto]',
        props.class,
      )
    "
  >
    <div class="min-w-0">
      <slot />
    </div>
    <slot name="action" />
  </div>
</template>

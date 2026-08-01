<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

// The small caps line that names what a heading belongs to. One of these, not one
// per surface: a dialog eyebrow and a panel eyebrow were never different things.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <p
    data-slot="eyebrow"
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

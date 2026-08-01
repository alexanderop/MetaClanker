<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

// The "nothing here yet" panel: a framed glyph over an explanation, centred in
// whatever region is empty. The glyph is decorative, so it never reaches the
// accessibility tree and the explanation carries the whole message.
const props = defineProps<{ glyph: string; class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div
    data-slot="empty-state"
    :class="
      cn(
        'grid h-full place-items-center content-center gap-[0.6rem] text-center text-text-muted',
        props.class,
      )
    "
  >
    <span
      data-slot="empty-state-glyph"
      class="grid size-12 place-items-center rounded-lg border border-border bg-surface text-accent-strong shadow-[var(--shadow-soft)]"
      aria-hidden="true"
      >{{ glyph }}</span
    >
    <slot />
  </div>
</template>

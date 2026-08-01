<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { statusBadgeVariants } from "./index.js";
import { cn } from "../utils.js";

// The dot is part of the badge, not of every call site: it carries no information
// a screen reader needs, and having each caller hand-write it is how one of them
// ends up without it.
const props = defineProps<{ status: string; class?: HTMLAttributes["class"] }>();
</script>

<template>
  <span
    data-slot="status-badge"
    :data-status="status"
    :class="cn(statusBadgeVariants(), props.class)"
  >
    <span
      data-slot="status-badge-dot"
      class="size-[0.36rem] rounded-full bg-current"
      aria-hidden="true"
    />
    <slot />
  </span>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { CollapsibleContent } from "reka-ui";

import { cn } from "../utils.js";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <CollapsibleContent data-slot="collapsible-content" :class="cn(props.class)">
    <slot />
  </CollapsibleContent>
</template>

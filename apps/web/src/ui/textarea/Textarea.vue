<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { useTemplateRef } from "vue";

import { cn } from "../utils.js";

// Deliberately frameless: every textarea in this app sits inside a composer shell
// that owns the border and focus ring, so a second border would read as a seam.
// Height and type scale are contextual and come from the caller's `class`.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
const element = useTemplateRef<HTMLTextAreaElement>("element");

defineExpose({ element });
</script>

<template>
  <textarea
    ref="element"
    data-slot="textarea"
    :class="
      cn(
        'block w-full resize-y border-0 bg-transparent text-text outline-0 placeholder:text-text-muted',
        props.class,
      )
    "
  />
</template>

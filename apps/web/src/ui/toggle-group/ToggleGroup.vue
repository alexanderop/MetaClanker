<script setup lang="ts" generic="TValue extends string">
import type { HTMLAttributes } from "vue";
import { ToggleGroupRoot } from "reka-ui";

import { cn } from "../utils.js";

/*
 * A narrow typed contract rather than a forward of reka's full `ToggleGroupRootProps`:
 * that type is a discriminated union over `type`, and every switch in this app is a
 * required single selection. The point of section 7.3 is that a misspelled handler
 * must fail to compile, and an explicit `modelValue`/`update:modelValue` pair does
 * that more strictly than forwarding the whole surface would.
 */
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
const model = defineModel<TValue>({ required: true });
</script>

<template>
  <ToggleGroupRoot
    v-model="model"
    data-slot="toggle-group"
    type="single"
    :class="
      cn('inline-flex items-center rounded-sm border border-border bg-canvas p-1', props.class)
    "
  >
    <slot />
  </ToggleGroupRoot>
</template>

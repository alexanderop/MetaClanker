<script setup lang="ts" generic="TValue extends string">
import type { HTMLAttributes } from "vue";

import type { ControlVariants } from "../control-variants.js";
import { controlVariants } from "../control-variants.js";
import { cn } from "../utils.js";

// A real <select>, deliberately not reka's custom listbox: Playwright `selectOption`
// and the browser suite's `selectOptions` drive a native element only. reka `Select`
// is reserved for pickers that need custom option rendering.
const props = withDefaults(
  defineProps<{ size?: ControlVariants["size"]; class?: HTMLAttributes["class"] }>(),
  { size: undefined, class: undefined },
);
const model = defineModel<TValue>({ required: true });
</script>

<template>
  <select
    v-model="model"
    data-slot="native-select"
    :class="cn(controlVariants({ size }), props.class)"
  >
    <slot />
  </select>
</template>

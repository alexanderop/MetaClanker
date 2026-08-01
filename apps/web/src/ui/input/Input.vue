<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { useTemplateRef } from "vue";

import type { ControlVariants } from "../control-variants.js";
import { controlVariants } from "../control-variants.js";
import { cn } from "../utils.js";

const props = withDefaults(
  defineProps<{ size?: ControlVariants["size"]; class?: HTMLAttributes["class"] }>(),
  { size: undefined, class: undefined },
);
const model = defineModel<string>({ required: true });
const element = useTemplateRef<HTMLInputElement>("element");

// Recovering focus after a rejected submit is the caller's job, so the element is
// reachable by intent rather than by reaching through the component instance.
defineExpose({ focus: () => element.value?.focus() });
</script>

<template>
  <input
    ref="element"
    v-model="model"
    data-slot="input"
    :class="cn(controlVariants({ size }), props.class)"
  />
</template>

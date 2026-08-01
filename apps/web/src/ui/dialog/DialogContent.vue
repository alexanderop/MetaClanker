<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { DialogContent, DialogPortal, useForwardPropsEmits } from "reka-ui";

import DialogOverlay from "./DialogOverlay.vue";
import { cn } from "../utils.js";

defineOptions({ inheritAttrs: false });

// `as` carries a concrete default because `reactiveOmit` turns optional props into
// required-but-possibly-undefined, which this repo's `exactOptionalPropertyTypes`
// rejects when forwarding. reka's own default for this element is "div".
const props = withDefaults(
  defineProps<DialogContentProps & { class?: HTMLAttributes["class"] }>(),
  { as: "div", class: undefined },
);
const emits = defineEmits<DialogContentEmits>();

// Forward reka's own props and emits as typed contracts rather than untyped
// attrs, so `vue-tsc` rejects a misspelled @escapeKeyDown or trapFocus at the
// call site. Only `class` is withheld — it merges through `cn` below.
const forwarded = useForwardPropsEmits(reactiveOmit(props, "class"), emits);
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[min(31rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-surface p-5 text-text shadow-[var(--shadow-popover)] focus:outline-none',
          props.class,
        )
      "
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>

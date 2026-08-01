<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Primitive } from "reka-ui";

import type { ButtonVariants } from "./index.js";
import { buttonVariants } from "./index.js";
import { cn } from "../utils.js";

const props = withDefaults(
  defineProps<
    PrimitiveProps & {
      variant?: ButtonVariants["variant"];
      size?: ButtonVariants["size"];
      class?: HTMLAttributes["class"];
    }
  >(),
  // `variant`/`size` intentionally default to undefined: cva's `defaultVariants`
  // is the single source of truth for the fallback appearance.
  { as: "button", variant: undefined, size: undefined, class: undefined },
);
</script>

<template>
  <Primitive
    data-slot="button"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>

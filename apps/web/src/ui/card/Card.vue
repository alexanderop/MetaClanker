<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { Primitive } from "reka-ui";

import type { CardVariants } from "./index.js";
import { cardVariants } from "./index.js";
import { cn } from "../utils.js";

// Polymorphic because the same surface is a <section> when it states something and
// a <details> when it hides something; the element is the caller's semantic choice.
const props = withDefaults(
  defineProps<PrimitiveProps & { tone?: CardVariants["tone"]; class?: HTMLAttributes["class"] }>(),
  { as: "div", tone: undefined, class: undefined },
);
</script>

<template>
  <Primitive
    data-slot="card"
    :as="as"
    :as-child="asChild"
    :class="cn(cardVariants({ tone }), props.class)"
  >
    <slot />
  </Primitive>
</template>

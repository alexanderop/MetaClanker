<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import type { ProviderMarkVariants } from "./index.js";
import { providerMarkVariants } from "./index.js";
import { cn } from "../utils.js";

const props = withDefaults(
  defineProps<{
    provider: string;
    size?: ProviderMarkVariants["size"];
    class?: HTMLAttributes["class"];
  }>(),
  { size: undefined, class: undefined },
);
</script>

<template>
  <span
    data-slot="provider-mark"
    :data-provider="provider"
    :class="cn(providerMarkVariants({ size }), props.class)"
    aria-hidden="true"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from "vue";

import { cn } from "../utils.js";

// `role="alert"` is part of the contract, not decoration: a validation or transport
// failure has to reach a screen reader the moment it is rendered.
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>

<template>
  <p
    data-slot="field-error"
    role="alert"
    :class="cn('m-0 text-[0.7rem] font-normal text-danger', props.class)"
  >
    <slot />
  </p>
</template>

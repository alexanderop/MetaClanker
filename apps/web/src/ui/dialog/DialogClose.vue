<script setup lang="ts">
import type { DialogCloseProps } from "reka-ui";
import { DialogClose } from "reka-ui";

// reka owns the dismissal semantics; this wrapper only names the slot so a parent
// can style around the close affordance without a descendant selector.
const props = withDefaults(defineProps<DialogCloseProps>(), { as: "button" });
</script>

<template>
  <DialogClose data-slot="dialog-close" :as="props.as" :as-child="props.asChild">
    <slot />
  </DialogClose>
</template>

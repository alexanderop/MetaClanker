<script setup lang="ts">
import { computed } from "vue";

import { Button } from "../button/index.js";

/*
 * Presentational on purpose: it is handed the scheme that is actually on screen
 * and reports the intent to flip, so the store stays the single owner of what
 * "system" resolves to.
 */
const props = defineProps<{ theme: "light" | "dark" }>();

defineEmits<{ toggle: [] }>();

const nextTheme = computed(() => (props.theme === "dark" ? "light" : "dark"));
</script>

<template>
  <Button
    data-slot="theme-toggle"
    variant="ghost"
    size="icon"
    type="button"
    :aria-label="$t(`settings.switchTo.${nextTheme}`)"
    :title="$t(`settings.switchTo.${nextTheme}`)"
    @click="$emit('toggle')"
  >
    <span aria-hidden="true">{{ theme === "dark" ? "☀" : "☾" }}</span>
  </Button>
</template>

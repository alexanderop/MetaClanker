<script setup lang="ts">
import { ref } from "vue";

import type { PendingInteraction } from "@metaclanker/contracts/wire";

import { useWorkspaceStore } from "../../shared/workspaceStore.js";

const props = defineProps<{ interaction: PendingInteraction }>();
const workspace = useWorkspaceStore();
const responding = ref(false);

const respond = async (optionId: string): Promise<void> => {
  responding.value = true;
  try {
    await workspace.respond(props.interaction, optionId);
  } finally {
    responding.value = false;
  }
};
</script>

<template>
  <section class="permission-card" :aria-labelledby="`permission-${interaction.id}`">
    <div class="permission-icon" aria-hidden="true">!</div>
    <div class="permission-content">
      <p class="eyebrow">{{ $t("thread.permission") }}</p>
      <h3 :id="`permission-${interaction.id}`">{{ interaction.title }}</h3>
      <pre v-if="interaction.description">{{ interaction.description }}</pre>
      <div class="permission-options">
        <button
          v-for="option in interaction.options"
          :key="option.optionId"
          class="button"
          :class="option.kind.startsWith('allow') ? 'primary' : 'secondary'"
          type="button"
          :disabled="responding"
          @click="respond(option.optionId)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </section>
</template>

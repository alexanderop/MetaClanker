<script setup lang="ts">
import { ref } from "vue";

import type { PendingInteraction } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
import { Card } from "../../ui/card/index.js";
import { Eyebrow } from "../../ui/eyebrow/index.js";
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
  <Card
    as="section"
    tone="warning"
    class="mt-5 ml-11.5 grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg p-3.5"
    :aria-labelledby="`permission-${interaction.id}`"
  >
    <div
      class="grid size-8 place-items-center rounded-full bg-warning font-extrabold text-accent-ink"
      aria-hidden="true"
    >
      !
    </div>
    <div>
      <Eyebrow>{{ $t("thread.permission") }}</Eyebrow>
      <h3 :id="`permission-${interaction.id}`" class="mt-1 mb-2 text-md">
        {{ interaction.title }}
      </h3>
      <pre
        v-if="interaction.description"
        class="m-0 mb-3 max-h-56 overflow-auto rounded-xs bg-sidebar p-3 font-mono text-[0.75em] whitespace-pre-wrap text-text-inverse"
        >{{ interaction.description }}</pre>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="option in interaction.options"
          :key="option.optionId"
          :variant="option.kind.startsWith('allow') ? 'primary' : 'secondary'"
          type="button"
          :disabled="responding"
          @click="respond(option.optionId)"
        >
          {{ option.label }}
        </Button>
      </div>
    </div>
  </Card>
</template>

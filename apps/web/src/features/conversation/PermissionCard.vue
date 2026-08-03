<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import type { PendingInteraction } from "@metaclanker/contracts/wire";

import { apiErrorMessage } from "../../shared/apiError.js";
import { Button } from "../../ui/button/index.js";
import { Card } from "../../ui/card/index.js";
import { Eyebrow } from "../../ui/eyebrow/index.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

const props = defineProps<{ interaction: PendingInteraction }>();
const workspace = useWorkspaceStore();
const { t } = useI18n();
const responding = ref(false);
const responseError = ref<string | null>(null);
const responsePending = computed(
  () => responding.value || props.interaction.status === "dispatching",
);

const respond = async (optionId: string): Promise<void> => {
  responseError.value = null;
  responding.value = true;
  try {
    await workspace.respond(props.interaction, optionId);
  } catch (cause) {
    const message = apiErrorMessage(cause, t("thread.permissionResponseFailed"));
    responseError.value = `${message} ${t("thread.permissionResponseStillHere")}`;
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
    :aria-busy="responsePending"
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
      <p v-if="responsePending" role="status" class="mb-3 text-sm text-text-muted">
        {{ $t("thread.permissionResponding") }}
      </p>
      <p v-else-if="responseError" role="alert" class="mb-3 text-sm text-danger">
        {{ responseError }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="option in interaction.options"
          :key="option.optionId"
          :variant="option.kind.startsWith('allow') ? 'primary' : 'secondary'"
          type="button"
          :disabled="responsePending || interaction.status !== 'pending'"
          @click="respond(option.optionId)"
        >
          {{ option.label }}
        </Button>
      </div>
    </div>
  </Card>
</template>

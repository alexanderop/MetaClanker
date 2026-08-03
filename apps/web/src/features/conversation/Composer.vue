<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { Thread, ThreadStatus } from "@metaclanker/contracts/wire";

import { apiErrorMessage } from "../../shared/apiError.js";
import { Button } from "../../ui/button/index.js";
import { FieldError } from "../../ui/field/index.js";
import { Textarea } from "../../ui/textarea/index.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

const props = defineProps<{ thread: Thread }>();
const workspace = useWorkspaceStore();
const activeStatuses = new Set<ThreadStatus>([
  "starting",
  "running",
  "waiting",
  "needs-input",
  "cancelling",
]);
const active = computed(() => activeStatuses.has(props.thread.status));
const { composerInput, focusComposer } = useComposerFocus();
const { draft, sending, sendError, send, updateDraft, onKeydown } = useFollowUpDraft();
const { cancelPending, cancelError, cancel } = useTurnCancellation();

function useComposerFocus() {
  const composerInput = useTemplateRef<{ element: HTMLTextAreaElement | null }>("composerInput");
  const focusComposer = async (): Promise<void> => {
    await nextTick();
    composerInput.value?.element?.focus();
  };

  onMounted(() => void focusComposer());

  return { composerInput, focusComposer };
}

function useFollowUpDraft() {
  const { t } = useI18n();
  const draft = ref(workspace.draftFor(props.thread.id));
  const sending = ref(false);
  const sendError = ref<string | null>(null);

  watch(
    () => props.thread.id,
    (id) => {
      draft.value = workspace.draftFor(id);
      sendError.value = null;
      void focusComposer();
    },
  );

  watch(draft, (value) => workspace.setDraft(props.thread.id, value));

  const send = async (): Promise<void> => {
    const text = draft.value.trim();
    if (text.length === 0 || active.value) return;
    sending.value = true;
    sendError.value = null;
    try {
      await workspace.sendPrompt(text);
      draft.value = "";
    } catch (cause) {
      sendError.value = apiErrorMessage(cause, t("common.requestFailed"));
    } finally {
      sending.value = false;
      await focusComposer();
    }
  };

  const updateDraft = (event: Event): void => {
    draft.value = (event.target as HTMLTextAreaElement).value;
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send();
  };

  return { draft, sending, sendError, send, updateDraft, onKeydown };
}

function useTurnCancellation() {
  const { t } = useI18n();
  const cancelling = ref(false);
  const cancelError = ref<string | null>(null);
  const cancelPending = computed(() => cancelling.value || props.thread.status === "cancelling");

  watch(
    () => props.thread.id,
    () => {
      cancelling.value = false;
      cancelError.value = null;
    },
  );

  watch(
    () => props.thread.status,
    (status) => {
      if (activeStatuses.has(status)) return;
      cancelling.value = false;
      cancelError.value = null;
      void focusComposer();
    },
  );

  const cancel = async (): Promise<void> => {
    if (cancelPending.value) return;
    cancelling.value = true;
    cancelError.value = null;
    try {
      await workspace.cancelPrompt();
    } catch (cause) {
      cancelError.value = apiErrorMessage(cause, t("common.requestFailed"));
      cancelling.value = false;
    }
  };

  return { cancelPending, cancelError, cancel };
}
</script>

<template>
  <footer class="bg-transparent px-[max(1rem,calc((100%-48rem)/2))] pt-2 pb-4">
    <div
      class="overflow-hidden rounded-xl border border-border-subtle bg-surface-glass shadow-soft backdrop-blur-lg transition-[border-color,box-shadow] duration-150 focus-within:border-accent-rim focus-within:shadow-selected"
      :class="active ? 'border-info-rim' : undefined"
    >
      <Textarea
        ref="composerInput"
        :value="draft"
        autofocus
        class="max-h-48 min-h-16 px-4 pt-3.5 pb-1 text-lg leading-normal"
        rows="2"
        :placeholder="$t('thread.composerPlaceholder')"
        :aria-label="$t('thread.composerPlaceholder')"
        :aria-describedby="
          sendError ? 'follow-up-send-error' : cancelError ? 'turn-cancellation-error' : undefined
        "
        :disabled="sending"
        @input="updateDraft"
        @keydown="onKeydown"
      />
      <p
        v-if="cancelPending"
        class="m-0 border-t border-border-subtle px-4 py-2 text-sm text-text-muted"
        role="status"
        :aria-label="$t('thread.stopping')"
      >
        {{ $t("thread.stopping") }}
      </p>
      <p
        v-else-if="sending"
        class="m-0 border-t border-border-subtle px-4 py-2 text-sm text-text-muted"
        role="status"
        :aria-label="$t('thread.sendingFollowUp')"
      >
        {{ $t("thread.sendingFollowUp") }}
      </p>
      <FieldError v-if="sendError" id="follow-up-send-error" class="px-4 py-2">
        {{ sendError }} {{ $t("thread.followUpStillHere") }}
      </FieldError>
      <FieldError v-else-if="cancelError" id="turn-cancellation-error" class="px-4 py-2">
        {{ cancelError }} {{ $t("thread.cancellationStillActive") }}
      </FieldError>
      <div class="flex items-center justify-between px-3 pt-1 pb-3">
        <div
          class="flex items-center gap-2 text-xs text-text-muted"
          :aria-label="$t('thread.agentSettings')"
        >
          <span class="capitalize">{{ thread.provider }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ thread.model ?? $t("thread.defaultModel") }}</span>
        </div>
        <Button
          v-if="active"
          variant="danger"
          size="icon"
          type="button"
          class="text-xs"
          :aria-label="$t(cancelPending ? 'thread.stopping' : 'thread.stop')"
          :disabled="cancelPending"
          @click="cancel"
        >
          <span aria-hidden="true">■</span>
        </Button>
        <Button
          v-else
          variant="primary"
          size="icon"
          type="button"
          :aria-label="$t(sending ? 'thread.sending' : 'thread.send')"
          :disabled="sending || draft.trim().length === 0"
          @click="send"
        >
          <span aria-hidden="true">↑</span>
        </Button>
      </div>
    </div>
  </footer>
</template>

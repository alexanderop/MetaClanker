<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { Thread, ThreadStatus } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
import { Textarea } from "../../ui/textarea/index.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

const props = defineProps<{ thread: Thread }>();
const workspace = useWorkspaceStore();
const draft = ref(workspace.draftFor(props.thread.id));
const sending = ref(false);

watch(
  () => props.thread.id,
  (id) => {
    draft.value = workspace.draftFor(id);
  },
);

watch(draft, (value) => workspace.setDraft(props.thread.id, value));

const activeStatuses = new Set<ThreadStatus>([
  "starting",
  "running",
  "waiting",
  "needs-input",
  "cancelling",
]);
const active = computed(() => activeStatuses.has(props.thread.status));

const send = async (): Promise<void> => {
  const text = draft.value.trim();
  if (text.length === 0 || active.value) return;
  sending.value = true;
  try {
    await workspace.sendPrompt(text);
    draft.value = "";
  } finally {
    sending.value = false;
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
</script>

<template>
  <footer
    class="border-t border-border-subtle bg-surface px-[max(1.3rem,calc((100%-52rem)/2))] pt-3 pb-[0.6rem]"
  >
    <div
      class="rounded-lg border border-border bg-surface-raised shadow-raised transition-[border-color,box-shadow] duration-150 focus-within:border-[color-mix(in_srgb,var(--color-accent-strong)_55%,var(--color-border))] focus-within:shadow-[var(--shadow-ring),var(--shadow-soft)]"
      :class="
        active ? 'border-[color-mix(in_srgb,var(--color-info)_48%,var(--color-border))]' : undefined
      "
    >
      <Textarea
        :value="draft"
        class="max-h-48 min-h-[3.35rem] px-[0.85rem] pt-[0.8rem] pb-[0.3rem] text-[0.82rem] leading-[1.5]"
        rows="2"
        :placeholder="$t('thread.composerPlaceholder')"
        :aria-label="$t('thread.composerPlaceholder')"
        :disabled="sending"
        @input="updateDraft"
        @keydown="onKeydown"
      />
      <div class="flex items-center justify-between px-[0.45rem] pt-[0.35rem] pb-[0.45rem]">
        <div class="flex items-center gap-1">
          <Button variant="outline" size="icon" type="button" aria-label="Attach a file">
            <span aria-hidden="true">＋</span>
          </Button>
          <Button variant="ghost" size="sm" type="button" class="capitalize">
            {{ thread.provider }}
          </Button>
          <Button variant="ghost" size="sm" type="button">Default permissions</Button>
        </div>
        <Button
          v-if="active"
          variant="danger"
          size="icon"
          type="button"
          class="text-[0.65rem]"
          :aria-label="$t('thread.stop')"
          @click="workspace.cancelPrompt"
        >
          <span aria-hidden="true">■</span>
        </Button>
        <Button
          v-else
          variant="primary"
          size="icon"
          type="button"
          :aria-label="$t('thread.send')"
          :disabled="sending || draft.trim().length === 0"
          @click="send"
        >
          <span aria-hidden="true">↑</span>
        </Button>
      </div>
    </div>
    <p class="mt-[0.35rem] mb-0 text-center text-[0.55rem] text-text-muted">
      Enter to send · Shift+Enter for a new line · MetaClanker runs locally
    </p>
  </footer>
</template>

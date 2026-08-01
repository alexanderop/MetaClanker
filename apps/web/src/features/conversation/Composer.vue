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
  <footer class="bg-transparent px-[max(1rem,calc((100%-48rem)/2))] pt-2 pb-4">
    <div
      class="overflow-hidden rounded-[1.35rem] border border-border-subtle bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] shadow-soft backdrop-blur-[16px] transition-[border-color,box-shadow] duration-150 focus-within:border-[color-mix(in_srgb,var(--color-accent-strong)_45%,var(--color-border))] focus-within:shadow-[var(--shadow-ring),var(--shadow-soft)]"
      :class="
        active ? 'border-[color-mix(in_srgb,var(--color-info)_48%,var(--color-border))]' : undefined
      "
    >
      <Textarea
        :value="draft"
        class="max-h-48 min-h-16 px-4 pt-3.5 pb-1 text-[0.86rem] leading-[1.5]"
        rows="2"
        :placeholder="$t('thread.composerPlaceholder')"
        :aria-label="$t('thread.composerPlaceholder')"
        :disabled="sending"
        @input="updateDraft"
        @keydown="onKeydown"
      />
      <div class="flex items-center justify-between px-3 pt-1 pb-3">
        <div
          class="flex items-center gap-2 text-[0.65rem] text-text-muted"
          aria-label="Agent settings"
        >
          <span class="capitalize">{{ thread.provider }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ thread.model ?? "Default model" }}</span>
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
  </footer>
</template>

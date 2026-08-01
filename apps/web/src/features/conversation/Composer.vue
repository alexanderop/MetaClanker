<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { Thread, ThreadStatus } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
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

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void send();
};
</script>

<template>
  <footer class="composer-wrap">
    <div class="composer" :class="{ active }">
      <textarea
        v-model="draft"
        rows="2"
        :placeholder="$t('thread.composerPlaceholder')"
        :aria-label="$t('thread.composerPlaceholder')"
        :disabled="sending"
        @keydown="onKeydown"
      />
      <div class="composer-toolbar">
        <div>
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
    <p>Enter to send · Shift+Enter for a new line · MetaClanker runs locally</p>
  </footer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { ProjectId } from "@metaclanker/contracts/ids";
import type { Provider } from "@metaclanker/contracts/wire";
import type { ConversationDraft } from "../shared/workspaceStore.js";

import { useWorkspaceStore } from "../shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const promptInput = useTemplateRef<HTMLTextAreaElement>("promptInput");
const discardDialog = useTemplateRef<HTMLDialogElement>("discardDialog");
const sending = ref(false);
const sendError = ref<string | null>(null);
const attachmentValue = ref("");
const acceptedDraft = shallowRef<ConversationDraft | null>(null);

const projectId = computed(() => ProjectId.make(String(route.params["projectId"] ?? "")));
const project = computed(() =>
  workspace.shell.projects.find((candidate) => candidate.id === projectId.value),
);
const draft = computed(
  () =>
    workspace.conversationDrafts[projectId.value] ??
    acceptedDraft.value ??
    workspace.draftForProject(projectId.value),
);
const sendReady = computed(
  () =>
    (draft.value.prompt.trim().length > 0 || draft.value.attachments.length > 0) &&
    workspace.providerReadiness.find((item) => item.provider === draft.value.provider)?.status ===
      "ready",
);
const selectedProviderReadiness = computed(() =>
  workspace.providerReadiness.find((item) => item.provider === draft.value.provider),
);

const selection = (target: HTMLTextAreaElement) => ({
  cursorStart: target.selectionStart,
  cursorEnd: target.selectionEnd,
});

const updatePrompt = (event: Event): void => {
  workspace.updateConversationDraft(projectId.value, {
    prompt: (event.target as HTMLTextAreaElement).value,
    ...selection(event.target as HTMLTextAreaElement),
  });
};

const updateCursor = (event: Event): void => {
  workspace.updateConversationDraft(
    projectId.value,
    selection(event.target as HTMLTextAreaElement),
  );
};

const updateProvider = (event: Event): void => {
  const provider: Provider =
    (event.target as HTMLSelectElement).value === "claude" ? "claude" : "codex";
  const defaults = workspace.settings.providerDefaults[provider];
  workspace.updateConversationDraft(projectId.value, {
    provider,
    model: defaults.model,
    effort: defaults.effort,
    permissionMode: defaults.permissionMode,
  });
};

const updateModel = (event: Event): void => {
  const value = (event.target as HTMLInputElement).value.trim();
  workspace.updateConversationDraft(projectId.value, { model: value.length === 0 ? null : value });
};

const updateEffort = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value;
  workspace.updateConversationDraft(projectId.value, {
    effort: value === "low" || value === "medium" || value === "high" ? value : null,
  });
};

const updatePermissionMode = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value;
  workspace.updateConversationDraft(projectId.value, {
    permissionMode:
      value === "read-only" || value === "workspace-write" || value === "full-access"
        ? value
        : null,
  });
};

const addAttachment = (): void => {
  const attachment = attachmentValue.value.trim();
  if (attachment.length === 0 || draft.value.attachments.includes(attachment)) return;
  workspace.updateConversationDraft(projectId.value, {
    attachments: [...draft.value.attachments, attachment],
  });
  attachmentValue.value = "";
};

const removeAttachment = (attachment: string): void => {
  workspace.updateConversationDraft(projectId.value, {
    attachments: draft.value.attachments.filter((item) => item !== attachment),
  });
};

const changeProject = async (event: Event): Promise<void> => {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "__add-project") {
    await router.push({ query: { addProject: "true" } });
    return;
  }
  const nextProjectId = ProjectId.make(value);
  await router.push({ name: "draft", params: { projectId: nextProjectId } });
};

const send = async (): Promise<void> => {
  if (!sendReady.value || sending.value) return;
  sending.value = true;
  sendError.value = null;
  try {
    const acceptedProjectId = projectId.value;
    const threadId = await workspace.startConversation(acceptedProjectId);
    acceptedDraft.value = draft.value;
    workspace.discardConversationDraft(acceptedProjectId);
    await router.replace({ name: "thread", params: { threadId } });
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>("#main-content textarea")?.focus(),
    );
  } catch (cause) {
    sendError.value = cause instanceof Error ? cause.message : String(cause);
    await nextTick();
    promptInput.value?.focus();
  } finally {
    sending.value = false;
  }
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void send();
};

const confirmDiscard = async (): Promise<void> => {
  workspace.discardConversationDraft(projectId.value);
  discardDialog.value?.close();
  await router.push({ name: "home" });
};

const discard = async (): Promise<void> => {
  if (draft.value.prompt.trim().length > 0 || draft.value.attachments.length > 0) {
    discardDialog.value?.showModal();
    return;
  }
  await confirmDiscard();
};

const focusComposer = (): void => {
  void nextTick(() => {
    const input = promptInput.value;
    if (input === null) return;
    input.focus();
    const maximum = input.value.length;
    input.setSelectionRange(
      Math.min(draft.value.cursorStart, maximum),
      Math.min(draft.value.cursorEnd, maximum),
    );
  });
};

watch(
  projectId,
  () => {
    sendError.value = null;
    focusComposer();
  },
  { immediate: true },
);
</script>

<template>
  <section v-if="project" class="draft-view" aria-labelledby="draft-title">
    <div class="draft-content">
      <p class="eyebrow">{{ $t("draft.eyebrow") }}</p>
      <h1 id="draft-title">
        {{ $t("draft.title") }}
        <label>
          <span class="sr-only">{{ $t("draft.project") }}</span>
          <select :value="projectId" :aria-label="$t('draft.project')" @change="changeProject">
            <option v-for="item in workspace.shell.projects" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
            <option value="__add-project">{{ $t("draft.addProject") }}</option>
          </select>
        </label>
        ?
      </h1>

      <div class="draft-composer">
        <textarea
          ref="promptInput"
          :value="draft.prompt"
          rows="5"
          :placeholder="$t('thread.composerPlaceholder')"
          :aria-label="$t('thread.composerPlaceholder')"
          :aria-describedby="sendError ? 'draft-send-error' : undefined"
          :disabled="sending"
          @input="updatePrompt"
          @keydown="onKeydown"
          @keyup="updateCursor"
          @select="updateCursor"
        />
        <p v-if="sendError" id="draft-send-error" class="form-error" role="alert">
          {{ sendError }} Your draft is still here.
        </p>
        <div class="draft-controls">
          <label>
            <span>{{ $t("draft.provider") }}</span>
            <select :value="draft.provider" @change="updateProvider">
              <option
                v-for="providerState in workspace.providerReadiness"
                :key="providerState.provider"
                :value="providerState.provider"
                :disabled="providerState.status !== 'ready'"
              >
                {{ providerState.provider === "codex" ? "Codex" : "Claude"
                }}{{ providerState.status === "ready" ? "" : " — unavailable" }}
              </option>
            </select>
          </label>
          <label>
            <span>{{ $t("draft.model") }}</span>
            <input
              :value="draft.model ?? ''"
              autocomplete="off"
              :placeholder="$t('draft.providerDefault')"
              @input="updateModel"
            />
          </label>
          <label>
            <span>{{ $t("draft.effort") }}</span>
            <select :value="draft.effort ?? ''" @change="updateEffort">
              <option value="">{{ $t("draft.default") }}</option>
              <option value="low">{{ $t("draft.low") }}</option>
              <option value="medium">{{ $t("draft.medium") }}</option>
              <option value="high">{{ $t("draft.high") }}</option>
            </select>
          </label>
          <label>
            <span>{{ $t("draft.permission") }}</span>
            <select :value="draft.permissionMode ?? ''" @change="updatePermissionMode">
              <option value="">{{ $t("draft.default") }}</option>
              <option value="read-only">{{ $t("draft.readOnly") }}</option>
              <option value="workspace-write">{{ $t("draft.workspaceWrite") }}</option>
              <option value="full-access">{{ $t("draft.fullAccess") }}</option>
            </select>
          </label>
          <button class="button quiet" type="button" @click="discard">
            {{ $t("draft.discard") }}
          </button>
          <button
            class="send-button"
            type="button"
            :aria-label="$t('thread.send')"
            :disabled="sending || !sendReady"
            @click="send"
          >
            <span aria-hidden="true">↑</span>
          </button>
        </div>
        <p
          v-if="selectedProviderReadiness?.status === 'unavailable'"
          class="provider-unavailable"
          role="status"
        >
          {{
            $t("draft.unavailable", {
              provider: selectedProviderReadiness.provider === "codex" ? "Codex" : "Claude",
              reason: selectedProviderReadiness.reason,
            })
          }}
        </p>
        <div class="draft-attachments">
          <label>
            <span>{{ $t("draft.attachLabel") }}</span>
            <span class="attachment-entry">
              <input
                v-model="attachmentValue"
                autocomplete="off"
                placeholder="file:///srv/project/notes.md"
                @keydown.enter.prevent="addAttachment"
              />
              <button class="button secondary" type="button" @click="addAttachment">
                {{ $t("draft.attach") }}
              </button>
            </span>
          </label>
          <ul v-if="draft.attachments.length > 0" :aria-label="$t('draft.attachments')">
            <li v-for="attachment in draft.attachments" :key="attachment">
              <span>{{ attachment }}</span>
              <button
                type="button"
                :aria-label="$t('draft.removeAttachment', { attachment })"
                @click="removeAttachment(attachment)"
              >
                ×
              </button>
            </li>
          </ul>
        </div>
      </div>
      <p class="draft-privacy">{{ $t("draft.privacy") }}</p>
    </div>
  </section>
  <section v-else class="center-state" role="alert">
    <h1>{{ $t("draft.unavailableProject") }}</h1>
    <RouterLink class="button secondary" :to="{ name: 'home' }">
      {{ $t("draft.chooseProject") }}
    </RouterLink>
  </section>

  <dialog ref="discardDialog" class="modal" aria-labelledby="discard-draft-title">
    <form method="dialog" @submit.prevent="confirmDiscard">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">{{ $t("draft.unsent") }}</p>
          <h2 id="discard-draft-title">{{ $t("draft.discardTitle") }}</h2>
        </div>
      </div>
      <p>{{ $t("draft.discardBody") }}</p>
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="discardDialog?.close()">
          {{ $t("draft.keep") }}
        </button>
        <button class="button danger" type="submit">{{ $t("draft.discard") }}</button>
      </div>
    </form>
  </dialog>
</template>

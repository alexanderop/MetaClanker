<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { ProjectId } from "@metaclanker/contracts/ids";
import type { Provider } from "@metaclanker/contracts/wire";
import type { ConversationDraft } from "../shared/workspaceStore.js";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog/index.js";
import { Button } from "../ui/button/index.js";
import { Eyebrow } from "../ui/eyebrow/index.js";
import { Field, FieldError } from "../ui/field/index.js";
import { Input } from "../ui/input/index.js";
import { NativeSelect } from "../ui/native-select/index.js";
import { Textarea } from "../ui/textarea/index.js";
import { useWorkspaceStore } from "../shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const promptInput = useTemplateRef<{ element: HTMLTextAreaElement | null }>("promptInput");
const discardOpen = ref(false);
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

// The draft controls are a single scrolling row of small captions, so they read one
// step quieter and one step tighter than a standalone field.
const draftViewClass =
  "grid min-h-full overflow-y-auto bg-canvas p-[clamp(1rem,4vw,3rem)] max-narrow:px-[0.85rem] max-narrow:pt-[4.25rem] max-narrow:pb-[1.2rem]";

const draftFieldClass =
  "min-w-[6rem] max-narrow:min-w-0 flex-[1_1_7rem] gap-[0.2rem] text-[0.58rem] text-text-muted";

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

const updateProvider = (value: string): void => {
  const provider: Provider = value === "claude" ? "claude" : "codex";
  const defaults = workspace.settings.providerDefaults[provider];
  workspace.updateConversationDraft(projectId.value, {
    provider,
    model: defaults.model,
    effort: defaults.effort,
    permissionMode: defaults.permissionMode,
  });
};

const updateModel = (value: string): void => {
  const model = value.trim();
  workspace.updateConversationDraft(projectId.value, { model: model.length === 0 ? null : model });
};

const updateEffort = (value: string): void => {
  workspace.updateConversationDraft(projectId.value, {
    effort: value === "low" || value === "medium" || value === "high" ? value : null,
  });
};

const updatePermissionMode = (value: string): void => {
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

const changeProject = async (value: string): Promise<void> => {
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
    promptInput.value?.element?.focus();
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
  discardOpen.value = false;
  await router.push({ name: "home" });
};

const discard = async (): Promise<void> => {
  if (draft.value.prompt.trim().length > 0 || draft.value.attachments.length > 0) {
    discardOpen.value = true;
    return;
  }
  await confirmDiscard();
};

const focusComposer = (): void => {
  void nextTick(() => {
    const input = promptInput.value?.element ?? null;
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
  <section v-if="project" :class="draftViewClass" aria-labelledby="draft-title">
    <div class="m-auto w-[min(52rem,100%)] self-center">
      <Eyebrow class="mb-[0.3rem] text-left text-text-muted">{{ $t("draft.eyebrow") }}</Eyebrow>
      <h1
        id="draft-title"
        class="m-0 mb-4 text-[clamp(1.15rem,2.2vw,1.65rem)] leading-[1.25] tracking-[-0.025em]"
      >
        {{ $t("draft.title") }}
        <label>
          <span class="sr-only">{{ $t("draft.project") }}</span>
          <NativeSelect
            :model-value="String(projectId)"
            :aria-label="$t('draft.project')"
            class="min-h-0 max-w-[min(18rem,70vw)] rounded-none border-0 border-b border-b-border bg-transparent px-0 py-0 text-[length:inherit] font-[650] text-text"
            @update:model-value="changeProject"
          >
            <option v-for="item in workspace.shell.projects" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
            <option value="__add-project">{{ $t("draft.addProject") }}</option>
          </NativeSelect>
        </label>
        ?
      </h1>

      <div class="overflow-hidden rounded-md border border-border bg-surface">
        <Textarea
          ref="promptInput"
          class="min-h-[7.5rem] p-4 text-[0.88rem] leading-[1.55]"
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
        <FieldError v-if="sendError" id="draft-send-error" class="px-[0.65rem]">
          {{ sendError }} Your draft is still here.
        </FieldError>
        <div
          class="flex items-end gap-[0.45rem] overflow-x-auto border-t border-border-subtle p-[0.65rem] max-narrow:grid max-narrow:grid-cols-2 max-narrow:overflow-visible"
        >
          <Field :class="draftFieldClass">
            <span>{{ $t("draft.provider") }}</span>
            <NativeSelect
              :model-value="draft.provider"
              size="sm"
              @update:model-value="updateProvider"
            >
              <option
                v-for="providerState in workspace.providerReadiness"
                :key="providerState.provider"
                :value="providerState.provider"
                :disabled="providerState.status !== 'ready'"
              >
                {{ providerState.provider === "codex" ? "Codex" : "Claude"
                }}{{ providerState.status === "ready" ? "" : " — unavailable" }}
              </option>
            </NativeSelect>
          </Field>
          <Field :class="draftFieldClass">
            <span>{{ $t("draft.model") }}</span>
            <Input
              :model-value="draft.model ?? ''"
              size="sm"
              autocomplete="off"
              :placeholder="$t('draft.providerDefault')"
              @update:model-value="updateModel"
            />
          </Field>
          <Field :class="draftFieldClass">
            <span>{{ $t("draft.effort") }}</span>
            <NativeSelect
              :model-value="draft.effort ?? ''"
              size="sm"
              @update:model-value="updateEffort"
            >
              <option value="">{{ $t("draft.default") }}</option>
              <option value="low">{{ $t("draft.low") }}</option>
              <option value="medium">{{ $t("draft.medium") }}</option>
              <option value="high">{{ $t("draft.high") }}</option>
            </NativeSelect>
          </Field>
          <Field :class="draftFieldClass">
            <span>{{ $t("draft.permission") }}</span>
            <NativeSelect
              :model-value="draft.permissionMode ?? ''"
              size="sm"
              @update:model-value="updatePermissionMode"
            >
              <option value="">{{ $t("draft.default") }}</option>
              <option value="read-only">{{ $t("draft.readOnly") }}</option>
              <option value="workspace-write">{{ $t("draft.workspaceWrite") }}</option>
              <option value="full-access">{{ $t("draft.fullAccess") }}</option>
            </NativeSelect>
          </Field>
          <Button variant="ghost" type="button" @click="discard">
            {{ $t("draft.discard") }}
          </Button>
          <Button
            variant="primary"
            size="icon"
            type="button"
            class="size-10 shrink-0 justify-self-end"
            :aria-label="$t('thread.send')"
            :disabled="sending || !sendReady"
            @click="send"
          >
            <span aria-hidden="true">↑</span>
          </Button>
        </div>
        <p
          v-if="selectedProviderReadiness?.status === 'unavailable'"
          class="m-0 border-t border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-border))] px-[0.8rem] py-[0.65rem] text-[0.68rem] text-danger"
          role="status"
        >
          {{
            $t("draft.unavailable", {
              provider: selectedProviderReadiness.provider === "codex" ? "Codex" : "Claude",
              reason: selectedProviderReadiness.reason,
            })
          }}
        </p>
        <div class="grid gap-[0.55rem] border-t border-border-subtle p-[0.7rem]">
          <Field class="gap-[0.35rem] text-[0.62rem] font-normal text-text-muted">
            <span>{{ $t("draft.attachLabel") }}</span>
            <span
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-[0.45rem] max-narrow:grid-cols-1 max-narrow:items-stretch"
            >
              <Input
                v-model="attachmentValue"
                size="sm"
                autocomplete="off"
                placeholder="file:///srv/project/notes.md"
                @keydown.enter.prevent="addAttachment"
              />
              <Button variant="secondary" type="button" @click="addAttachment">
                {{ $t("draft.attach") }}
              </Button>
            </span>
          </Field>
          <ul
            v-if="draft.attachments.length > 0"
            class="m-0 flex list-none flex-wrap gap-[0.35rem] p-0"
            :aria-label="$t('draft.attachments')"
          >
            <li
              v-for="attachment in draft.attachments"
              :key="attachment"
              class="flex max-w-full items-center gap-[0.35rem] rounded-full bg-surface-raised px-[0.45rem] py-[0.3rem] text-[0.62rem]"
            >
              <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ attachment }}</span>
              <button
                class="min-h-6 min-w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
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
      <p class="mt-3 mb-0 text-left text-[0.65rem] text-text-muted">{{ $t("draft.privacy") }}</p>
    </div>
  </section>
  <section
    v-else
    class="grid h-full place-items-center content-center gap-[0.8rem] text-center text-text-muted"
    role="alert"
  >
    <h1>{{ $t("draft.unavailableProject") }}</h1>
    <Button as-child variant="secondary">
      <RouterLink :to="{ name: 'home' }">{{ $t("draft.chooseProject") }}</RouterLink>
    </Button>
  </section>

  <Dialog v-model:open="discardOpen">
    <DialogContent>
      <form class="grid gap-4" @submit.prevent="confirmDiscard">
        <DialogHeader>
          <Eyebrow>{{ $t("draft.unsent") }}</Eyebrow>
          <DialogTitle>{{ $t("draft.discardTitle") }}</DialogTitle>
        </DialogHeader>
        <DialogDescription>{{ $t("draft.discardBody") }}</DialogDescription>
        <DialogFooter>
          <Button variant="secondary" type="button" @click="discardOpen = false">
            {{ $t("draft.keep") }}
          </Button>
          <Button variant="danger" type="submit">{{ $t("draft.discard") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

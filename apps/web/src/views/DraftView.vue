<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { ProjectId } from "@metaclanker/contracts/ids";
import type { Provider, ProviderReadiness } from "@metaclanker/contracts/wire";
import type { ConversationDraft } from "../shared/workspaceStore.js";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog/index.js";
import { apiErrorMessage } from "../shared/apiError.js";
import { Button } from "../ui/button/index.js";
import { Eyebrow } from "../ui/eyebrow/index.js";
import { Field, FieldError } from "../ui/field/index.js";
import { Input } from "../ui/input/index.js";
import { NativeSelect } from "../ui/native-select/index.js";
import { ProviderMark } from "../ui/provider-mark/index.js";
import { Textarea } from "../ui/textarea/index.js";
import { useWorkspaceStore } from "../shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();

const selection = (target: HTMLTextAreaElement) => ({
  cursorStart: target.selectionStart,
  cursorEnd: target.selectionEnd,
});

const { projectId, project, draft, retainDraft, changeProject } = useDraftProject();
const { promptInput, focusPrompt } = useComposerFocus();
const {
  updatePrompt,
  updateCursor,
  updateProvider,
  updateModel,
  updateEffort,
  updatePermissionMode,
  providerLabel,
  providerName,
  permissionDescription,
} = useDraftFields();
const {
  attachmentInput,
  attachmentValue,
  attachmentError,
  attachmentsOpen,
  toggleAttachments,
  addAttachment,
  removeAttachment,
} = useAttachments();
const {
  modelCatalogOpen,
  modelQuery,
  advertisedModels,
  recentModels,
  customModel,
  refreshModelCatalog,
  chooseModel,
} = useModelCatalog();
const { sending, sendError, sendReady, selectedProviderReadiness, send, onKeydown } =
  useSendDraft();
const { discardOpen, discard, confirmDiscard } = useDiscardDraft();

function useDraftProject() {
  // The draft the user just sent, kept so the view renders its final state
  // instead of flashing empty while the router moves to the new thread.
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

  const retainDraft = (accepted: ConversationDraft): void => {
    acceptedDraft.value = accepted;
  };

  const changeProject = async (value: string): Promise<void> => {
    if (value === "__add-project") {
      await router.push({ query: { addProject: "true" } });
      return;
    }
    const nextProjectId = ProjectId.make(value);
    await router.push({ name: "draft", params: { projectId: nextProjectId } });
  };

  return { projectId, project, draft, retainDraft, changeProject };
}

function useComposerFocus() {
  const promptInput = useTemplateRef<{ element: HTMLTextAreaElement | null }>("promptInput");

  const focusPrompt = async (): Promise<void> => {
    await nextTick();
    promptInput.value?.element?.focus();
  };

  // Returning to a draft restores the caret where the user left it.
  const restoreComposer = (): void => {
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

  watch(projectId, restoreComposer, { immediate: true });

  return { promptInput, focusPrompt };
}

function useDraftFields() {
  const { t } = useI18n();

  const providerName = (provider: Provider): string =>
    t(provider === "codex" ? "providers.codex" : "providers.claude");

  const providerLabel = (readiness: ProviderReadiness): string =>
    readiness.status === "ready"
      ? providerName(readiness.provider)
      : t("draft.providerUnavailableOption", {
          provider: providerName(readiness.provider),
          reason: readiness.reason ?? t("draft.unavailableReasonUnknown"),
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
    workspace.updateConversationDraft(projectId.value, {
      model: model.length === 0 ? null : model,
    });
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

  const permissionDescription = computed(() => {
    switch (draft.value.permissionMode) {
      case "read-only":
        return t("draft.permissionReadOnlyDescription");
      case "workspace-write":
        return t("draft.permissionWorkspaceWriteDescription");
      case "full-access":
        return t("draft.permissionFullAccessDescription");
      default:
        return t("draft.permissionDefaultDescription", {
          provider: providerName(draft.value.provider),
        });
    }
  });

  return {
    updatePrompt,
    updateCursor,
    updateProvider,
    updateModel,
    updateEffort,
    updatePermissionMode,
    providerLabel,
    providerName,
    permissionDescription,
  };
}

function useAttachments() {
  const { t } = useI18n();
  const attachmentInput = useTemplateRef<{ focus: () => void }>("attachmentInput");
  const attachmentValue = ref("");
  const attachmentError = ref<string | null>(null);
  const attachmentsOpen = ref(false);

  const focusAttachmentInput = (): void => {
    void nextTick(() => attachmentInput.value?.focus());
  };

  const toggleAttachments = (): void => {
    attachmentsOpen.value = !attachmentsOpen.value;
    if (attachmentsOpen.value) focusAttachmentInput();
  };

  const addAttachment = (): void => {
    const attachment = attachmentValue.value.trim();
    try {
      if (attachment.length === 0 || new URL(attachment).protocol.length === 0) throw new Error();
    } catch {
      attachmentError.value = t("draft.invalidAttachment");
      focusAttachmentInput();
      return;
    }
    if (draft.value.attachments.includes(attachment)) {
      attachmentError.value = t("draft.duplicateAttachment");
      focusAttachmentInput();
      return;
    }
    workspace.updateConversationDraft(projectId.value, {
      attachments: [...draft.value.attachments, attachment],
    });
    attachmentValue.value = "";
    attachmentError.value = null;
    focusAttachmentInput();
  };

  const removeAttachment = (attachment: string): void => {
    workspace.updateConversationDraft(projectId.value, {
      attachments: draft.value.attachments.filter((item) => item !== attachment),
    });
    attachmentError.value = null;
    focusAttachmentInput();
  };

  watch(attachmentValue, () => {
    attachmentError.value = null;
  });

  watch(
    projectId,
    () => {
      attachmentsOpen.value = draft.value.attachments.length > 0;
      attachmentError.value = null;
    },
    { immediate: true },
  );

  return {
    attachmentInput,
    attachmentValue,
    attachmentError,
    attachmentsOpen,
    toggleAttachments,
    addAttachment,
    removeAttachment,
  };
}

function useModelCatalog() {
  const modelCatalogOpen = ref(false);
  const modelQuery = ref("");
  const selectedReadiness = computed(() =>
    workspace.providerReadiness.find((item) => item.provider === draft.value.provider),
  );
  const advertised = computed(() => selectedReadiness.value?.models ?? []);
  const recent = computed(() => {
    const candidates = [
      draft.value.model,
      workspace.settings.providerDefaults[draft.value.provider].model,
      ...workspace.shell.threads
        .filter((thread) => thread.provider === draft.value.provider)
        .map((thread) => thread.model),
    ];
    return [...new Set(candidates.filter((model): model is string => model !== null))].filter(
      (model) => !advertised.value.includes(model),
    );
  });
  const queryMatches = (model: string): boolean =>
    model.toLocaleLowerCase().includes(modelQuery.value.trim().toLocaleLowerCase());
  const advertisedModels = computed(() => advertised.value.filter(queryMatches));
  const recentModels = computed(() => recent.value.filter(queryMatches));
  const customModel = computed(() => {
    const candidate = modelQuery.value.trim();
    if (candidate.length === 0 || [...advertised.value, ...recent.value].includes(candidate)) {
      return null;
    }
    return candidate;
  });
  const chooseModel = (model: string | null): void => {
    updateModel(model ?? "");
    modelCatalogOpen.value = false;
  };
  const refreshModelCatalog = (): void => {
    void workspace.refreshProviderReadiness().catch(() => undefined);
  };
  watch(modelCatalogOpen, (open) => {
    if (open) modelQuery.value = "";
  });

  return {
    modelCatalogOpen,
    modelQuery,
    advertisedModels,
    recentModels,
    customModel,
    refreshModelCatalog,
    chooseModel,
  };
}

function useSendDraft() {
  const { t } = useI18n();
  const sending = ref(false);
  const sendError = ref<string | null>(null);

  const selectedProviderReadiness = computed(() =>
    workspace.providerReadiness.find((item) => item.provider === draft.value.provider),
  );

  const sendReady = computed(
    () =>
      (draft.value.prompt.trim().length > 0 || draft.value.attachments.length > 0) &&
      selectedProviderReadiness.value?.status === "ready",
  );

  const send = async (): Promise<void> => {
    if (!sendReady.value || sending.value) return;
    sending.value = true;
    sendError.value = null;
    try {
      const acceptedProjectId = projectId.value;
      const threadId = await workspace.startConversation(acceptedProjectId);
      retainDraft(draft.value);
      workspace.discardConversationDraft(acceptedProjectId);
      await router.replace({ name: "thread", params: { threadId } });
      requestAnimationFrame(() =>
        document.querySelector<HTMLTextAreaElement>("#main-content textarea")?.focus(),
      );
    } catch (cause) {
      sendError.value = apiErrorMessage(cause, t("common.requestFailed"));
      await focusPrompt();
    } finally {
      sending.value = false;
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send();
  };

  watch(
    projectId,
    () => {
      sendError.value = null;
    },
    { immediate: true },
  );

  return { sending, sendError, sendReady, selectedProviderReadiness, send, onKeydown };
}

function useDiscardDraft() {
  const discardOpen = ref(false);

  const confirmDiscard = async (): Promise<void> => {
    workspace.discardConversationDraft(projectId.value);
    discardOpen.value = false;
    await router.push({ name: "home" });
  };

  // Only interrupt the user when discarding would lose something.
  const discard = async (): Promise<void> => {
    if (draft.value.prompt.trim().length > 0 || draft.value.attachments.length > 0) {
      discardOpen.value = true;
      return;
    }
    await confirmDiscard();
  };

  return { discardOpen, discard, confirmDiscard };
}
</script>

<template>
  <section
    v-if="project"
    class="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-canvas"
    aria-labelledby="draft-title"
  >
    <header
      class="flex min-h-13 items-center justify-between gap-3 border-b border-border-subtle bg-canvas-glass px-4 py-1.5 backdrop-blur-lg max-narrow:pl-17"
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <h1 id="draft-title" class="m-0 shrink-0 text-lg font-semibold tracking-tight">
          {{ $t("draft.newTitle") }}
        </h1>
        <label class="min-w-0">
          <span class="sr-only">{{ $t("draft.project") }}</span>
          <NativeSelect
            :model-value="String(projectId)"
            :aria-label="$t('draft.project')"
            class="min-h-7 max-w-48 rounded-xs border-border bg-surface-raised px-2 py-0 text-sm font-semibold"
            @update:model-value="changeProject"
          >
            <option v-for="item in workspace.shell.projects" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
            <option value="__add-project">{{ $t("draft.addProject") }}</option>
          </NativeSelect>
        </label>
      </div>
      <Button variant="ghost" size="sm" type="button" @click="discard">
        <svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5" fill="none">
          <path
            d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="max-narrow:sr-only">{{ $t("draft.discard") }}</span>
      </Button>
    </header>

    <div class="grid min-h-0 place-items-center px-4 text-center">
      <p class="m-0 max-w-full text-sm text-text-muted/45">
        {{ $t("draft.emptyMessage") }}
      </p>
    </div>

    <div
      class="relative z-10 min-w-0 px-[clamp(0.75rem,3vw,2rem)] pb-[clamp(0.75rem,2.5vw,1.5rem)]"
    >
      <div class="mx-auto min-w-0 w-full max-w-3xl">
        <div
          class="min-w-0 w-full overflow-hidden rounded-xl border border-border bg-surface-glass shadow-soft backdrop-blur-lg transition-[border-color,box-shadow] duration-150 focus-within:border-accent-rim focus-within:shadow-selected"
        >
          <Textarea
            ref="promptInput"
            class="max-h-52 min-h-20 resize-none px-4 pt-4 pb-2 text-lg leading-normal"
            :value="draft.prompt"
            rows="3"
            :placeholder="$t('thread.composerPlaceholder')"
            :aria-label="$t('thread.composerPlaceholder')"
            :aria-describedby="sendError ? 'draft-send-error' : undefined"
            :disabled="sending"
            @input="updatePrompt"
            @keydown="onKeydown"
            @keyup="updateCursor"
            @select="updateCursor"
          />
          <ul
            v-if="draft.attachments.length > 0"
            class="m-0 flex list-none flex-wrap gap-1.5 px-4 pb-2 p-0"
            :aria-label="$t('draft.attachments')"
          >
            <li
              v-for="attachment in draft.attachments"
              :key="attachment"
              class="flex max-w-full items-center gap-1.5 rounded-full bg-surface-raised px-2 py-1 text-xs"
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
          <FieldError v-if="sendError" id="draft-send-error" class="px-4 pb-2">
            {{ sendError }} {{ $t("draft.stillHere") }}
          </FieldError>
          <p
            v-if="sending"
            class="m-0 border-t border-border-subtle px-4 py-2 text-sm text-text-muted"
            role="status"
          >
            {{ $t("draft.starting") }}
          </p>
          <div
            v-if="attachmentsOpen"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-t border-border-subtle px-3 py-2.5 max-narrow:grid-cols-1"
          >
            <Field class="gap-1 text-2xs font-normal text-text-muted">
              <span>{{ $t("draft.attachLabel") }}</span>
              <Input
                ref="attachmentInput"
                v-model="attachmentValue"
                size="sm"
                autofocus
                autocomplete="off"
                :aria-describedby="attachmentError ? 'draft-attachment-error' : undefined"
                placeholder="file:///srv/project/notes.md"
                @keydown.enter.prevent="addAttachment"
              />
            </Field>
            <Button variant="secondary" type="button" @click="addAttachment">
              {{ $t("draft.attach") }}
            </Button>
            <FieldError v-if="attachmentError" id="draft-attachment-error" class="col-span-full">
              {{ attachmentError }}
            </FieldError>
          </div>
          <p
            v-if="selectedProviderReadiness?.status === 'unavailable'"
            class="m-0 border-t border-danger-rim px-3 py-2 text-sm text-danger"
            role="status"
          >
            {{
              $t("draft.unavailable", {
                provider: providerName(selectedProviderReadiness.provider),
                reason: selectedProviderReadiness.reason,
              })
            }}
          </p>
          <div
            class="flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border-subtle px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <Field class="flex shrink-0 items-center gap-1 text-2xs font-normal">
              <span class="sr-only">{{ $t("draft.provider") }}</span>
              <ProviderMark
                :provider="draft.provider"
                size="sm"
                class="size-4 rounded-full text-2xs"
              >
                {{ draft.provider === "codex" ? "C" : "A" }}
              </ProviderMark>
              <NativeSelect
                :model-value="draft.provider"
                size="sm"
                class="min-h-8 w-auto max-w-24 border-0 bg-transparent px-1.5 py-1 font-semibold text-text-muted hover:bg-surface-raised hover:text-text"
                @update:model-value="updateProvider"
              >
                <option
                  v-for="providerState in workspace.providerReadiness"
                  :key="providerState.provider"
                  :value="providerState.provider"
                  :disabled="providerState.status !== 'ready'"
                >
                  {{ providerLabel(providerState) }}
                </option>
              </NativeSelect>
            </Field>
            <span aria-hidden="true" class="mx-0.5 h-4 w-px shrink-0 bg-border-subtle" />
            <Field class="flex shrink-0 items-center text-2xs font-normal">
              <span class="sr-only">{{ $t("draft.model") }}</span>
              <Input
                :model-value="draft.model ?? ''"
                size="sm"
                class="min-h-8 w-32 border-0 bg-transparent px-1.5 py-1 font-semibold text-text-muted hover:bg-surface-raised hover:text-text"
                autocomplete="off"
                :placeholder="$t('draft.providerDefault')"
                @update:model-value="updateModel"
              />
            </Field>
            <Dialog v-model:open="modelCatalogOpen">
              <DialogTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  :aria-label="$t('draft.browseModels')"
                  @click="refreshModelCatalog"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5" fill="none">
                    <path
                      d="M5 7h14M5 12h14M5 17h14"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                    />
                  </svg>
                </Button>
              </DialogTrigger>
              <DialogContent
                class="max-h-[min(38rem,calc(100vh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)]"
              >
                <DialogHeader>
                  <div>
                    <Eyebrow>{{ providerName(draft.provider) }}</Eyebrow>
                    <DialogTitle>{{ $t("draft.chooseModel") }}</DialogTitle>
                  </div>
                </DialogHeader>
                <DialogDescription>{{ $t("draft.modelCatalogDescription") }}</DialogDescription>
                <div class="grid min-h-0 gap-3">
                  <Input
                    v-model="modelQuery"
                    autofocus
                    autocomplete="off"
                    :aria-label="$t('draft.searchModels')"
                    :placeholder="$t('draft.searchModels')"
                  />
                  <div class="min-h-0 overflow-y-auto pr-1">
                    <div class="grid gap-1">
                      <Button
                        variant="ghost"
                        type="button"
                        class="justify-start"
                        :aria-pressed="draft.model === null"
                        @click="chooseModel(null)"
                      >
                        {{ $t("draft.providerDefault") }}
                      </Button>
                    </div>
                    <section v-if="advertisedModels.length > 0" class="mt-4 grid gap-1">
                      <h2
                        class="m-0 px-2 text-2xs font-semibold uppercase tracking-wide text-text-muted"
                      >
                        {{ $t("draft.availableModels") }}
                      </h2>
                      <Button
                        v-for="model in advertisedModels"
                        :key="model"
                        variant="ghost"
                        type="button"
                        class="justify-start"
                        :aria-pressed="draft.model === model"
                        @click="chooseModel(model)"
                      >
                        {{ model }}
                      </Button>
                    </section>
                    <section v-if="recentModels.length > 0" class="mt-4 grid gap-1">
                      <h2
                        class="m-0 px-2 text-2xs font-semibold uppercase tracking-wide text-text-muted"
                      >
                        {{ $t("draft.recentModels") }}
                      </h2>
                      <Button
                        v-for="model in recentModels"
                        :key="model"
                        variant="ghost"
                        type="button"
                        class="justify-start"
                        :aria-pressed="draft.model === model"
                        @click="chooseModel(model)"
                      >
                        {{ model }}
                      </Button>
                    </section>
                    <p
                      v-if="
                        modelQuery.trim().length === 0 &&
                        advertisedModels.length === 0 &&
                        recentModels.length === 0
                      "
                      class="mx-2 my-4 text-sm leading-relaxed text-text-muted"
                    >
                      {{ $t("draft.noModelsDiscovered") }}
                    </p>
                    <p
                      v-else-if="
                        advertisedModels.length === 0 &&
                        recentModels.length === 0 &&
                        customModel === null
                      "
                      class="mx-2 my-4 text-sm text-text-muted"
                    >
                      {{ $t("draft.noModelMatches") }}
                    </p>
                    <Button
                      v-if="customModel"
                      variant="secondary"
                      type="button"
                      class="mt-4 w-full justify-start"
                      @click="chooseModel(customModel)"
                    >
                      {{ $t("draft.useCustomModel", { model: customModel }) }}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <span aria-hidden="true" class="mx-0.5 h-4 w-px shrink-0 bg-border-subtle" />
            <Field class="flex shrink-0 items-center text-2xs font-normal">
              <span class="sr-only">{{ $t("draft.effort") }}</span>
              <NativeSelect
                :model-value="draft.effort ?? ''"
                size="sm"
                class="min-h-8 w-auto border-0 bg-transparent px-1.5 py-1 font-semibold text-text-muted hover:bg-surface-raised hover:text-text"
                @update:model-value="updateEffort"
              >
                <option value="">{{ $t("draft.default") }}</option>
                <option value="low">{{ $t("draft.low") }}</option>
                <option value="medium">{{ $t("draft.medium") }}</option>
                <option value="high">{{ $t("draft.high") }}</option>
              </NativeSelect>
            </Field>
            <span aria-hidden="true" class="mx-0.5 h-4 w-px shrink-0 bg-border-subtle" />
            <Field class="flex shrink-0 items-center text-2xs font-normal">
              <span class="sr-only">{{ $t("draft.permission") }}</span>
              <NativeSelect
                :model-value="draft.permissionMode ?? ''"
                aria-describedby="draft-permission-description"
                size="sm"
                class="min-h-8 w-auto border-0 bg-transparent px-1.5 py-1 font-semibold text-text-muted hover:bg-surface-raised hover:text-text"
                @update:model-value="updatePermissionMode"
              >
                <option value="">{{ $t("draft.default") }}</option>
                <option value="read-only">{{ $t("draft.readOnly") }}</option>
                <option value="workspace-write">{{ $t("draft.workspaceWrite") }}</option>
                <option value="full-access">{{ $t("draft.fullAccess") }}</option>
              </NativeSelect>
            </Field>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              class="ml-0.5"
              :aria-label="$t('draft.addAttachment')"
              :aria-expanded="attachmentsOpen"
              @click="toggleAttachments"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5" fill="none">
                <path
                  d="m8.5 12.5 6.1-6.1a3.2 3.2 0 0 1 4.5 4.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.1-8.1"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
            </Button>
            <Button
              variant="primary"
              size="icon"
              type="button"
              class="ml-auto size-9 shrink-0 rounded-full"
              :aria-label="$t(sending ? 'thread.sending' : 'thread.send')"
              :disabled="sending || !sendReady"
              @click="send"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="none">
                <path
                  d="M12 19V5m0 0-5 5m5-5 5 5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </Button>
          </div>
          <p
            id="draft-permission-description"
            class="m-0 border-t border-border-subtle px-4 py-1.5 text-2xs text-text-muted"
          >
            {{ permissionDescription }}
          </p>
        </div>
        <div class="flex items-center justify-between gap-3 px-5.5 pt-2 text-xs text-text-muted">
          <span class="flex min-w-0 items-center gap-1.5">
            <svg aria-hidden="true" viewBox="0 0 24 24" class="size-3.5 shrink-0" fill="none">
              <path
                d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
            </svg>
            <span>{{ $t("draft.serverProject") }}</span>
          </span>
          <span class="truncate">{{ project.gitBranch ?? $t("draft.gitUnavailable") }}</span>
        </div>
        <p class="mt-2 mb-0 text-center text-2xs text-text-muted/75">
          {{ $t("draft.privacy") }}
        </p>
      </div>
    </div>
  </section>
  <section
    v-else
    class="grid h-full place-items-center content-center gap-3 text-center text-text-muted"
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

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { onKeyStroke } from "@vueuse/core";

import { ProjectId } from "@metaclanker/contracts/ids";
import type { DirectoryBrowserResponse } from "@metaclanker/contracts/wire";

import {
  desktopDirectoryPickerAvailable,
  selectDesktopProjectDirectory,
} from "../../shared/desktopBridge.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog/index.js";
import { Eyebrow } from "../../ui/eyebrow/index.js";
import { Field, FieldError, FieldHint } from "../../ui/field/index.js";
import { Button } from "../../ui/button/index.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible/index.js";
import { Input } from "../../ui/input/index.js";
import { NativeSelect } from "../../ui/native-select/index.js";
import { api } from "../../shared/apiClient.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

defineProps<{ open: boolean; collapsed: boolean }>();
const emit = defineEmits<{ close: []; toggleCollapse: [] }>();

const workspace = useWorkspaceStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const projectOpen = ref(false);
const paletteOpen = ref(false);
const settingsOpen = ref(false);
const projectPathInput = useTemplateRef<{ focus: () => void }>("projectPathInput");
const directoryList = useTemplateRef<HTMLUListElement>("directoryList");
const path = ref("");
const name = ref("");
const saving = ref(false);
const addError = ref<string | null>(null);
const directoryBrowser = ref<DirectoryBrowserResponse | null>(null);
const browsing = ref(false);
const browseError = ref<string | null>(null);
const theme = ref(workspace.settings.theme);
const graphDensity = ref(workspace.settings.graphDensity);

const visibleProjects = computed(() =>
  workspace.shell.projects
    .filter((project) => !project.hidden)
    .toSorted((left, right) => left.order - right.order),
);

const selectedThreadId = computed(() =>
  typeof route.params["threadId"] === "string" ? route.params["threadId"] : null,
);

const routeProjectId = computed<string | null>(() => {
  if (route.name === "draft" && typeof route.params["projectId"] === "string") {
    return route.params["projectId"];
  }
  if (route.name === "thread") return workspace.detail?.thread.projectId ?? null;
  return null;
});

const threadsForProject = (projectId: ProjectId) =>
  workspace.shell.threads.filter((thread) => thread.projectId === projectId && !thread.archived);

const projectName = (projectId: ProjectId): string =>
  workspace.shell.projects.find((project) => project.id === projectId)?.name ??
  t("projects.unknown");

const contextualProjectId = (): ProjectId | null => {
  const routeContext = routeProjectId.value;
  if (routeContext !== null) return ProjectId.make(routeContext);
  const recentProjectId = workspace.shell.threads.find((thread) => !thread.archived)?.projectId;
  if (recentProjectId !== undefined) return recentProjectId;
  return visibleProjects.value[0]?.id ?? null;
};

// Two modal layers must never overlap: reka returns focus to whatever was focused
// when a dialog closes, so a replacement opened in the same tick loses focus to it.
const closePalette = async (): Promise<void> => {
  if (!paletteOpen.value) return;
  paletteOpen.value = false;
  await nextTick();
};

const newChat = async (projectId = contextualProjectId()): Promise<void> => {
  await closePalette();
  if (projectId === null) {
    await openAddProject();
    return;
  }
  workspace.draftForProject(projectId);
  await router.push({ name: "draft", params: { projectId } });
  emit("close");
};

const focusProjectPath = async (): Promise<void> => {
  await nextTick();
  projectPathInput.value?.focus();
};

const openAddProject = async (): Promise<void> => {
  await closePalette();
  addError.value = null;
  if (desktopDirectoryPickerAvailable()) {
    const selected = await selectDesktopProjectDirectory();
    if (selected === null) return;
    path.value = selected;
    name.value = "";
    if (await persistProject()) return;
    projectOpen.value = true;
    await focusProjectPath();
    return;
  }
  projectOpen.value = true;
  void browseDirectories();
};

const browseDirectories = async (nextPath?: string): Promise<void> => {
  browsing.value = true;
  browseError.value = null;
  try {
    directoryBrowser.value = await api.browseProjectDirectories(nextPath);
    path.value = directoryBrowser.value.currentPath;
    await nextTick();
    directoryList.value?.querySelector("button")?.focus();
  } catch (cause) {
    browseError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    browsing.value = false;
  }
};

const chooseDirectory = async (): Promise<void> => {
  const selected = await selectDesktopProjectDirectory();
  if (selected !== null) path.value = selected;
};

const persistProject = async (): Promise<boolean> => {
  saving.value = true;
  addError.value = null;
  try {
    const project = await workspace.createProject(path.value.trim(), name.value.trim());
    path.value = "";
    name.value = "";
    projectOpen.value = false;
    await newChat(project.id);
    return true;
  } catch (cause) {
    addError.value = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    saving.value = false;
  }
};

const addProject = async (): Promise<void> => {
  if (await persistProject()) return;
  await focusProjectPath();
};

const openSettings = async (): Promise<void> => {
  await closePalette();
  theme.value = workspace.settings.theme;
  graphDensity.value = workspace.settings.graphDensity;
  settingsOpen.value = true;
};

const saveSettings = async (): Promise<void> => {
  await workspace.saveSettings({
    ...workspace.settings,
    theme: theme.value,
    graphDensity: graphDensity.value,
  });
  settingsOpen.value = false;
};

const commandChord =
  (key: string) =>
  (event: KeyboardEvent): boolean =>
    (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLocaleLowerCase() === key;

onKeyStroke(commandChord("k"), (event) => {
  event.preventDefault();
  paletteOpen.value = true;
});

onKeyStroke(commandChord("n"), (event) => {
  event.preventDefault();
  void newChat();
});

watch(projectOpen, (isOpen) => {
  if (!isOpen) addError.value = null;
});

watch(
  () => route.query["addProject"],
  (requested) => {
    if (requested !== "true") return;
    void router.replace({ query: {} }).then(openAddProject);
  },
  { immediate: true },
);

watch(
  () => route.query["settings"],
  (requested) => {
    if (requested !== "true") return;
    void router.replace({ query: {} }).then(openSettings);
  },
  { immediate: true },
);
</script>

<template>
  <aside class="sidebar" :class="{ open, collapsed }" :aria-label="$t('navigation.conversations')">
    <div class="brand">
      <div class="brand-copy">
        <strong>{{ $t("app.name") }}</strong>
        <span>LOCAL</span>
      </div>
      <button
        class="sidebar-compose-button"
        type="button"
        :aria-label="$t('navigation.newChat')"
        :title="$t('navigation.newChat')"
        @click="newChat()"
      >
        <span aria-hidden="true">✎</span>
      </button>
      <button
        class="sidebar-collapse-button"
        type="button"
        :aria-label="collapsed ? $t('navigation.expand') : $t('navigation.collapse')"
        :title="collapsed ? $t('navigation.expand') : $t('navigation.collapse')"
        @click="emit('toggleCollapse')"
      >
        <span aria-hidden="true">{{ collapsed ? "›" : "‹" }}</span>
      </button>
      <button
        class="sidebar-close-button"
        type="button"
        :aria-label="$t('navigation.close')"
        @click="emit('close')"
      >
        ×
      </button>
    </div>

    <div class="projects-heading">
      <span>{{ $t("navigation.projects") }}</span>
      <button
        class="folder-add-button"
        type="button"
        :aria-label="$t('projects.add')"
        :title="$t('projects.add')"
        @click="openAddProject"
      >
        <span aria-hidden="true">＋</span>
      </button>
    </div>

    <nav class="conversation-list" :aria-label="$t('navigation.threads')">
      <button
        v-if="visibleProjects.length === 0"
        class="sidebar-empty-project"
        type="button"
        @click="openAddProject"
      >
        <span aria-hidden="true">▣</span>
        {{ $t("projects.addFirst") }}
      </button>
      <Collapsible
        v-for="project in visibleProjects"
        v-else
        :key="project.id"
        as="section"
        default-open
        class="project-group"
      >
        <div
          class="flex items-center rounded-sm hover:bg-sidebar-row"
          :class="{ 'bg-sidebar-row': routeProjectId === project.id }"
        >
          <CollapsibleTrigger
            class="grid min-h-[2.25rem] w-[1.4rem] shrink-0 place-items-center text-[0.68rem] text-sidebar-text-faint transition-transform data-[state=closed]:-rotate-90"
            :aria-label="$t('navigation.toggleProject', { project: project.name })"
          >
            <span aria-hidden="true">⌄</span>
          </CollapsibleTrigger>
          <button
            class="grid min-h-[2.25rem] min-w-0 flex-1 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-[0.48rem] border-0 bg-transparent px-[0.25rem] py-[0.35rem] text-left text-sidebar-text"
            type="button"
            :aria-label="$t('navigation.newChatInProject', { project: project.name })"
            @click="newChat(project.id)"
          >
            <span class="text-base text-sidebar-text-dim" aria-hidden="true">▱</span>
            <strong
              class="overflow-hidden text-[0.74rem] font-[620] text-ellipsis whitespace-nowrap"
            >
              {{ project.name }}
            </strong>
          </button>
        </div>
        <CollapsibleContent v-if="threadsForProject(project.id).length > 0">
          <ul class="thread-list">
            <li v-for="thread in threadsForProject(project.id)" :key="thread.id">
              <RouterLink
                :to="{ name: 'thread', params: { threadId: thread.id } }"
                :class="{ active: selectedThreadId === thread.id }"
                :aria-label="`${thread.title}, ${projectName(thread.projectId)}, ${thread.status}`"
                @click="emit('close')"
              >
                <span class="thread-row-copy">
                  <strong>{{ thread.title }}</strong>
                </span>
                <time
                  :datetime="thread.updatedAt"
                  :title="new Date(thread.updatedAt).toLocaleString()"
                >
                  {{ new Date(thread.updatedAt).toLocaleDateString() }}
                </time>
              </RouterLink>
            </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </nav>

    <div class="sidebar-footer">
      <button type="button" @click="openSettings">
        <span aria-hidden="true">⚙</span> {{ $t("settings.title") }}
      </button>
    </div>
  </aside>

  <Dialog v-model:open="projectOpen">
    <DialogContent>
      <form class="grid gap-4" @submit.prevent="addProject">
        <DialogHeader>
          <Eyebrow>{{ $t("projects.add") }}</Eyebrow>
          <DialogTitle>{{ $t("projects.chooseServerDirectory") }}</DialogTitle>
          <template #action>
            <DialogClose as-child>
              <Button variant="outline" size="icon" :aria-label="$t('common.close')">×</Button>
            </DialogClose>
          </template>
        </DialogHeader>
        <DialogDescription class="sr-only">{{ $t("projects.addDescription") }}</DialogDescription>

        <div
          v-if="!desktopDirectoryPickerAvailable()"
          class="grid min-h-[12rem] gap-[0.65rem] rounded-md border border-border bg-surface-raised p-3"
          aria-live="polite"
        >
          <div
            class="flex items-center justify-between gap-[0.65rem] max-narrow:flex-col max-narrow:items-stretch"
          >
            <strong
              class="overflow-hidden font-mono text-[0.68rem] text-ellipsis whitespace-nowrap text-text-muted"
            >
              {{ directoryBrowser?.currentPath ?? $t("projects.loadingDirectories") }}
            </strong>
            <Button
              v-if="directoryBrowser?.parentPath"
              variant="secondary"
              type="button"
              :disabled="browsing"
              @click="browseDirectories(directoryBrowser.parentPath ?? undefined)"
            >
              {{ $t("projects.up") }}
            </Button>
          </div>
          <p v-if="browsing" class="m-0 text-[0.64rem] font-normal text-text-muted">
            {{ $t("projects.loadingDirectories") }}
          </p>
          <FieldError v-else-if="browseError">
            {{ browseError }}
            <Button variant="secondary" type="button" @click="browseDirectories()">
              {{ $t("projects.retryBrowse") }}
            </Button>
          </FieldError>
          <ul
            v-else-if="directoryBrowser && directoryBrowser.entries.length > 0"
            ref="directoryList"
            class="grid max-h-[13rem] list-none overflow-y-auto p-0"
          >
            <li v-for="entry in directoryBrowser.entries" :key="entry.path">
              <Button
                variant="list"
                size="list"
                type="button"
                @click="browseDirectories(entry.path)"
              >
                <span aria-hidden="true">▣</span>{{ entry.name }}
              </Button>
            </li>
          </ul>
          <p v-else-if="directoryBrowser" class="m-0 text-[0.64rem] font-normal text-text-muted">
            {{ $t("projects.noChildren") }}
          </p>
          <p class="m-0 text-[0.64rem] font-normal text-text-muted">
            {{ $t("projects.serverFolderCue") }}
          </p>
        </div>

        <Field v-else>
          <span>{{ $t("projects.selectedPath") }}</span>
          <Input ref="projectPathInput" v-model="path" required readonly />
          <Button variant="secondary" type="button" @click="chooseDirectory">
            {{ $t("projects.anotherDirectory") }}
          </Button>
          <FieldHint>{{ $t("projects.pathHint") }}</FieldHint>
        </Field>

        <details
          v-if="!desktopDirectoryPickerAvailable()"
          class="rounded-sm border border-border-subtle px-[0.65rem] py-[0.55rem] [&[open]_summary]:mb-3"
        >
          <summary class="cursor-pointer text-[0.68rem] text-text-muted">
            {{ $t("projects.manualPath") }}
          </summary>
          <Field>
            <span>{{ $t("projects.absoluteServerPath") }}</span>
            <Input
              ref="projectPathInput"
              v-model="path"
              required
              autocomplete="off"
              placeholder="/srv/projects/example"
              :aria-invalid="addError ? 'true' : undefined"
              :aria-describedby="addError ? 'add-project-error' : 'project-path-hint'"
            />
            <FieldHint id="project-path-hint">{{ $t("projects.permittedPathHint") }}</FieldHint>
          </Field>
        </details>

        <details
          class="rounded-sm border border-border-subtle px-[0.65rem] py-[0.55rem] [&[open]_summary]:mb-3"
        >
          <summary class="cursor-pointer text-[0.68rem] text-text-muted">
            {{ $t("projects.advanced") }}
          </summary>
          <Field>
            <span>{{ $t("projects.name") }}</span>
            <Input v-model="name" autocomplete="off" :placeholder="$t('projects.inferredName')" />
          </Field>
        </details>

        <FieldError v-if="addError" id="add-project-error">{{ addError }}</FieldError>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">{{ $t("common.cancel") }}</Button>
          </DialogClose>
          <Button variant="primary" type="submit" :disabled="saving || path.trim().length === 0">
            {{ saving ? $t("projects.adding") : $t("projects.add") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="paletteOpen">
    <DialogContent class="p-[1.1rem]">
      <DialogHeader>
        <Eyebrow>{{ $t("navigation.workspace") }}</Eyebrow>
        <DialogTitle>{{ $t("navigation.palette") }}</DialogTitle>
        <template #action>
          <DialogClose as-child>
            <Button variant="outline" size="icon" :aria-label="$t('common.close')">×</Button>
          </DialogClose>
        </template>
      </DialogHeader>
      <DialogDescription class="sr-only">
        {{ $t("navigation.paletteDescription") }}
      </DialogDescription>
      <div class="grid gap-[0.3rem]">
        <Button variant="list" size="list" type="button" @click="newChat()">
          {{ $t("navigation.newChat") }}
        </Button>
        <Button variant="list" size="list" type="button" @click="openAddProject">
          {{ $t("projects.add") }}
        </Button>
        <Button variant="list" size="list" type="button" @click="openSettings">
          {{ $t("settings.open") }}
        </Button>
      </div>
      <div v-if="visibleProjects.length > 1" class="grid gap-[0.3rem]">
        <p class="m-0 text-[0.65rem] text-text-muted">{{ $t("navigation.newChatIn") }}</p>
        <Button
          v-for="project in visibleProjects"
          :key="project.id"
          variant="list"
          size="list"
          type="button"
          @click="newChat(project.id)"
        >
          {{ project.name }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="settingsOpen">
    <DialogContent>
      <form class="grid gap-4" @submit.prevent="saveSettings">
        <DialogHeader>
          <Eyebrow>{{ $t("settings.preferences") }}</Eyebrow>
          <DialogTitle>{{ $t("settings.title") }}</DialogTitle>
          <template #action>
            <DialogClose as-child>
              <Button variant="outline" size="icon" :aria-label="$t('common.close')">×</Button>
            </DialogClose>
          </template>
        </DialogHeader>
        <DialogDescription class="sr-only">{{ $t("settings.description") }}</DialogDescription>
        <Field>
          <span>{{ $t("settings.theme") }}</span>
          <NativeSelect v-model="theme">
            <option value="system">{{ $t("settings.system") }}</option>
            <option value="light">{{ $t("settings.light") }}</option>
            <option value="dark">{{ $t("settings.dark") }}</option>
          </NativeSelect>
        </Field>
        <Field>
          <span>{{ $t("settings.density") }}</span>
          <NativeSelect v-model="graphDensity">
            <option value="comfortable">{{ $t("settings.comfortable") }}</option>
            <option value="compact">{{ $t("settings.compact") }}</option>
          </NativeSelect>
        </Field>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary">{{ $t("common.cancel") }}</Button>
          </DialogClose>
          <Button variant="primary" type="submit">{{ $t("common.save") }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

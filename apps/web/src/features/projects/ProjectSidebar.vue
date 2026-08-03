<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { onKeyStroke } from "@vueuse/core";

import { ProjectId } from "@metaclanker/contracts/ids";
import type { DirectoryBrowserResponse, Project } from "@metaclanker/contracts/wire";

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
import { apiErrorMessage } from "../../shared/apiError.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

defineProps<{ open: boolean; collapsed: boolean }>();
const emit = defineEmits<{ close: []; toggleCollapse: [] }>();

const commandChord =
  (key: string) =>
  (event: KeyboardEvent): boolean =>
    (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLocaleLowerCase() === key;

const workspace = useWorkspaceStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const {
  visibleProjects,
  selectedThreadId,
  routeProjectId,
  threadsForProject,
  projectName,
  relativeThreadAge,
  contextualProjectId,
} = useSidebarProjects();
const {
  paletteOpen,
  paletteFirstAction,
  paletteShortcut,
  openPalette,
  closePalette,
  focusPaletteFirstAction,
} = useCommandPalette();
const {
  projectOpen,
  path,
  name,
  saving,
  addError,
  directoryBrowser,
  browsing,
  browseError,
  openAddProject,
  browseDirectories,
  chooseDirectory,
  addProject,
} = useAddProject();
const {
  settingsOpen,
  theme,
  graphDensity,
  settingsSaving,
  settingsError,
  openSettings,
  saveSettings,
  preventSettingsDismiss,
} = useSettingsDialog();
useDeepLinkedDialogs({ openAddProject, openSettings });

// The sidebar's single entry into a conversation. It stays at the top level
// because both the palette and project creation route back through it.
async function newChat(projectId = contextualProjectId()): Promise<void> {
  await closePalette();
  if (projectId === null) {
    await openAddProject();
    return;
  }
  workspace.draftForProject(projectId);
  await router.push({ name: "draft", params: { projectId } });
  emit("close");
}

function useSidebarProjects() {
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

  const relativeThreadAge = (timestamp: string): string => {
    const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return t("time.now");
    if (minutes < 60) return t("time.minutesAgo", { count: minutes });

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });

    const days = Math.floor(hours / 24);
    if (days < 30) return t("time.daysAgo", { count: days });

    const months = Math.floor(days / 30);
    if (months < 12) return t("time.monthsAgo", { count: months });
    return t("time.yearsAgo", { count: Math.floor(days / 365) });
  };

  // Where a new conversation lands when the user did not pick a project.
  const contextualProjectId = (): ProjectId | null => {
    const routeContext = routeProjectId.value;
    if (routeContext !== null) return ProjectId.make(routeContext);
    const recentProjectId = workspace.shell.threads.find((thread) => !thread.archived)?.projectId;
    if (recentProjectId !== undefined) return recentProjectId;
    return visibleProjects.value[0]?.id ?? null;
  };

  return {
    visibleProjects,
    selectedThreadId,
    routeProjectId,
    threadsForProject,
    projectName,
    relativeThreadAge,
    contextualProjectId,
  };
}

function useCommandPalette() {
  const paletteOpen = ref(false);
  const paletteFirstAction = useTemplateRef<HTMLButtonElement>("paletteFirstAction");
  const paletteShortcut = computed(() =>
    /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      ? t("navigation.paletteShortcutMac")
      : t("navigation.paletteShortcutOther"),
  );

  const openPalette = (): void => {
    paletteOpen.value = true;
  };

  // Two modal layers must never overlap: reka returns focus to whatever was focused
  // when a dialog closes, so a replacement opened in the same tick loses focus to it.
  const closePalette = async (): Promise<void> => {
    if (!paletteOpen.value) return;
    paletteOpen.value = false;
    await nextTick();
  };

  onKeyStroke(commandChord("k"), (event) => {
    event.preventDefault();
    openPalette();
  });

  onKeyStroke(commandChord("n"), (event) => {
    event.preventDefault();
    void newChat();
  });

  const focusPaletteFirstAction = (event: Event): void => {
    event.preventDefault();
    paletteFirstAction.value?.focus();
  };

  return {
    paletteOpen,
    paletteFirstAction,
    paletteShortcut,
    openPalette,
    closePalette,
    focusPaletteFirstAction,
  };
}

function useDirectoryBrowser() {
  const directoryList = useTemplateRef<HTMLUListElement>("directoryList");
  const directoryBrowser = ref<DirectoryBrowserResponse | null>(null);
  const browsing = ref(false);
  const browseError = ref<string | null>(null);

  // Resolves to the directory now being shown, or null when browsing failed.
  const browse = async (nextPath?: string): Promise<string | null> => {
    browsing.value = true;
    browseError.value = null;
    try {
      directoryBrowser.value = await api.browseProjectDirectories(nextPath);
      await nextTick();
      directoryList.value?.querySelector("button")?.focus();
      return directoryBrowser.value.currentPath;
    } catch (cause) {
      browseError.value = apiErrorMessage(cause, t("common.requestFailed"));
      return null;
    } finally {
      browsing.value = false;
    }
  };

  return { directoryBrowser, browsing, browseError, browse };
}

function useAddProject() {
  const { directoryBrowser, browsing, browseError, browse } = useDirectoryBrowser();
  const projectPathInput = useTemplateRef<{ focus: () => void }>("projectPathInput");
  const projectOpen = ref(false);
  const path = ref("");
  const name = ref("");
  const saving = ref(false);
  const addError = ref<string | null>(null);

  const focusProjectPath = async (): Promise<void> => {
    await nextTick();
    projectPathInput.value?.focus();
  };

  const browseDirectories = async (nextPath?: string): Promise<void> => {
    const currentPath = await browse(nextPath);
    if (currentPath !== null) path.value = currentPath;
  };

  const chooseDirectory = async (): Promise<void> => {
    const selected = await selectDesktopProjectDirectory();
    if (selected !== null) path.value = selected;
  };

  // Creates the project and resets the form. Navigation is the caller's job, so
  // that creating a project and starting its first chat stay separable.
  const persistProject = async (): Promise<Project | null> => {
    saving.value = true;
    addError.value = null;
    try {
      const project = await workspace.createProject(path.value.trim(), name.value.trim());
      path.value = "";
      name.value = "";
      projectOpen.value = false;
      return project;
    } catch (cause) {
      addError.value = apiErrorMessage(cause, t("common.requestFailed"));
      return null;
    } finally {
      saving.value = false;
    }
  };

  const openAddProject = async (): Promise<void> => {
    await closePalette();
    addError.value = null;
    if (desktopDirectoryPickerAvailable()) {
      const selected = await selectDesktopProjectDirectory();
      if (selected === null) return;
      path.value = selected;
      name.value = "";
      const created = await persistProject();
      if (created !== null) {
        await newChat(created.id);
        return;
      }
      projectOpen.value = true;
      await focusProjectPath();
      return;
    }
    projectOpen.value = true;
    void browseDirectories();
  };

  const addProject = async (): Promise<void> => {
    const created = await persistProject();
    if (created !== null) {
      await newChat(created.id);
      return;
    }
    await focusProjectPath();
  };

  watch(projectOpen, (isOpen) => {
    if (!isOpen) addError.value = null;
  });

  return {
    projectOpen,
    path,
    name,
    saving,
    addError,
    directoryBrowser,
    browsing,
    browseError,
    openAddProject,
    browseDirectories,
    chooseDirectory,
    addProject,
  };
}

function useSettingsDialog() {
  const settingsOpen = ref(false);
  const theme = ref(workspace.settings.theme);
  const graphDensity = ref(workspace.settings.graphDensity);
  const settingsSaving = ref(false);
  const settingsError = ref<string | null>(null);

  const openSettings = async (): Promise<void> => {
    await closePalette();
    theme.value = workspace.settings.theme;
    graphDensity.value = workspace.settings.graphDensity;
    settingsError.value = null;
    settingsOpen.value = true;
  };

  const saveSettings = async (): Promise<void> => {
    if (settingsSaving.value) return;
    settingsSaving.value = true;
    settingsError.value = null;
    try {
      await workspace.saveSettings({
        ...workspace.settings,
        theme: theme.value,
        graphDensity: graphDensity.value,
      });
      settingsOpen.value = false;
    } catch (cause) {
      settingsError.value = apiErrorMessage(cause, t("settings.saveFailed"));
    } finally {
      settingsSaving.value = false;
    }
  };

  const preventSettingsDismiss = (event: Event): void => {
    if (settingsSaving.value) event.preventDefault();
  };

  watch(theme, (nextTheme) => {
    if (settingsOpen.value) workspace.previewTheme(nextTheme);
  });

  watch(settingsOpen, (isOpen) => {
    if (isOpen) return;
    workspace.previewTheme(workspace.settings.theme);
    settingsError.value = null;
  });

  return {
    settingsOpen,
    theme,
    graphDensity,
    settingsSaving,
    settingsError,
    openSettings,
    saveSettings,
    preventSettingsDismiss,
  };
}

// `?addProject=true` and `?settings=true` let other views open a sidebar dialog.
// The query is cleared first so a back navigation does not reopen it.
function useDeepLinkedDialogs(dialogs: {
  openAddProject: () => Promise<void>;
  openSettings: () => Promise<void>;
}) {
  const openOnQuery = (key: string, open: () => Promise<void>): void => {
    watch(
      () => route.query[key],
      (requested) => {
        if (requested !== "true") return;
        void router.replace({ query: {} }).then(open);
      },
      { immediate: true },
    );
  };

  openOnQuery("addProject", dialogs.openAddProject);
  openOnQuery("settings", dialogs.openSettings);
}
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
        <svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="none">
          <path
            d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
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
        <svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
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
          class="group flex min-h-9 items-center rounded-sm px-0.5 transition-colors hover:bg-sidebar-row"
          :class="{ 'bg-sidebar-row': routeProjectId === project.id }"
        >
          <CollapsibleTrigger
            class="group/project-toggle flex min-h-9 min-w-0 flex-1 items-center gap-2 px-0.5 py-1.5 text-left text-sidebar-text"
            :aria-label="$t('navigation.toggleProject', { project: project.name })"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              class="size-4 shrink-0 text-sidebar-text-faint transition-transform group-data-[state=closed]/project-toggle:-rotate-90"
              fill="none"
            >
              <path
                d="m4 6 4 4 4-4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              class="size-4 shrink-0 text-sidebar-text-dim"
              fill="none"
            >
              <path
                d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
            </svg>
            <strong class="overflow-hidden text-md font-semibold text-ellipsis whitespace-nowrap">
              {{ project.name }}
            </strong>
          </CollapsibleTrigger>
          <button
            class="grid size-8 shrink-0 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-sidebar-text-dim opacity-0 transition-[color,background-color,opacity] group-hover:opacity-100 hover:bg-sidebar-rule hover:text-sidebar-text focus-visible:opacity-100"
            :class="{ 'opacity-100': routeProjectId === project.id }"
            type="button"
            :aria-label="$t('navigation.newChatInProject', { project: project.name })"
            :title="$t('navigation.newChatInProject', { project: project.name })"
            @click="newChat(project.id)"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" class="size-4" fill="none">
              <path
                d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
        <CollapsibleContent v-if="threadsForProject(project.id).length > 0">
          <ul class="thread-list">
            <li v-for="thread in threadsForProject(project.id)" :key="thread.id">
              <RouterLink
                :to="{ name: 'thread', params: { threadId: thread.id } }"
                :class="{ active: selectedThreadId === thread.id }"
                :aria-label="
                  $t('navigation.threadLabel', {
                    title: thread.title,
                    project: projectName(thread.projectId),
                    status: $t(`thread.status.${thread.status}`),
                  })
                "
                @click="emit('close')"
              >
                <span class="thread-row-copy">
                  <strong>{{ thread.title }}</strong>
                </span>
                <time
                  :datetime="thread.updatedAt"
                  :title="new Date(thread.updatedAt).toLocaleString()"
                >
                  {{ relativeThreadAge(thread.updatedAt) }}
                </time>
              </RouterLink>
            </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </nav>

    <div class="sidebar-footer">
      <button type="button" :aria-label="$t('navigation.search')" @click="openPalette">
        <span aria-hidden="true">⌕</span>
        <span>{{ $t("navigation.search") }}</span>
        <kbd aria-hidden="true">{{ paletteShortcut }}</kbd>
      </button>
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
          class="grid min-h-48 gap-2.5 rounded-md border border-border bg-surface-raised p-3"
          aria-live="polite"
        >
          <div
            class="flex items-center justify-between gap-2.5 max-narrow:flex-col max-narrow:items-stretch"
          >
            <strong
              class="overflow-hidden font-mono text-sm text-ellipsis whitespace-nowrap text-text-muted"
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
          <p v-if="browsing" class="m-0 text-xs font-normal text-text-muted">
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
            class="grid max-h-52 list-none overflow-y-auto p-0"
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
          <p v-else-if="directoryBrowser" class="m-0 text-xs font-normal text-text-muted">
            {{ $t("projects.noChildren") }}
          </p>
          <p class="m-0 text-xs font-normal text-text-muted">
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
          class="rounded-sm border border-border-subtle px-2.5 py-2 [&[open]_summary]:mb-3"
        >
          <summary class="cursor-pointer text-sm text-text-muted">
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

        <details class="rounded-sm border border-border-subtle px-2.5 py-2 [&[open]_summary]:mb-3">
          <summary class="cursor-pointer text-sm text-text-muted">
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
    <DialogContent class="p-4.5" @open-auto-focus="focusPaletteFirstAction">
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
      <div class="grid gap-1">
        <Button as-child variant="list" size="list">
          <button ref="paletteFirstAction" type="button" @click="newChat()">
            {{ $t("navigation.newChat") }}
          </button>
        </Button>
        <Button variant="list" size="list" type="button" @click="openAddProject">
          {{ $t("projects.add") }}
        </Button>
        <Button variant="list" size="list" type="button" @click="openSettings">
          {{ $t("settings.open") }}
        </Button>
      </div>
      <div v-if="visibleProjects.length > 1" class="grid gap-1">
        <p class="m-0 text-xs text-text-muted">{{ $t("navigation.newChatIn") }}</p>
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
    <DialogContent
      @escape-key-down="preventSettingsDismiss"
      @pointer-down-outside="preventSettingsDismiss"
    >
      <form class="grid gap-4" @submit.prevent="saveSettings">
        <DialogHeader>
          <Eyebrow>{{ $t("settings.preferences") }}</Eyebrow>
          <DialogTitle>{{ $t("settings.title") }}</DialogTitle>
          <template #action>
            <DialogClose as-child>
              <Button
                variant="outline"
                size="icon"
                :aria-label="$t('common.close')"
                :disabled="settingsSaving"
              >
                ×
              </Button>
            </DialogClose>
          </template>
        </DialogHeader>
        <DialogDescription class="sr-only">{{ $t("settings.description") }}</DialogDescription>
        <Field>
          <span>{{ $t("settings.theme") }}</span>
          <NativeSelect v-model="theme" :disabled="settingsSaving">
            <option value="system">{{ $t("settings.system") }}</option>
            <option value="light">{{ $t("settings.light") }}</option>
            <option value="dark">{{ $t("settings.dark") }}</option>
          </NativeSelect>
        </Field>
        <Field>
          <span>{{ $t("settings.density") }}</span>
          <NativeSelect v-model="graphDensity" :disabled="settingsSaving">
            <option value="comfortable">{{ $t("settings.comfortable") }}</option>
            <option value="compact">{{ $t("settings.compact") }}</option>
          </NativeSelect>
        </Field>
        <FieldError v-if="settingsError">{{ settingsError }}</FieldError>
        <DialogFooter>
          <DialogClose as-child>
            <Button variant="secondary" :disabled="settingsSaving">{{
              $t("common.cancel")
            }}</Button>
          </DialogClose>
          <Button variant="primary" type="submit" :disabled="settingsSaving">{{
            $t(settingsSaving ? "settings.saving" : "common.save")
          }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

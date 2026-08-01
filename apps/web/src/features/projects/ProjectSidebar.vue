<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";

import { ProjectId } from "@metaclanker/contracts/ids";
import type { DirectoryBrowserResponse } from "@metaclanker/contracts/wire";

import {
  desktopDirectoryPickerAvailable,
  selectDesktopProjectDirectory,
} from "../../shared/desktopBridge.js";
import { api } from "../../shared/apiClient.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

defineProps<{ open: boolean; collapsed: boolean }>();
const emit = defineEmits<{ close: []; toggleCollapse: [] }>();

const workspace = useWorkspaceStore();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const projectDialog = useTemplateRef<HTMLDialogElement>("projectDialog");
const projectPathInput = useTemplateRef<HTMLInputElement>("projectPathInput");
const settingsDialog = useTemplateRef<HTMLDialogElement>("settingsDialog");
const paletteDialog = useTemplateRef<HTMLDialogElement>("paletteDialog");
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

const newChat = async (projectId = contextualProjectId()): Promise<void> => {
  paletteDialog.value?.close();
  if (projectId === null) {
    await openAddProject();
    return;
  }
  workspace.draftForProject(projectId);
  await router.push({ name: "draft", params: { projectId } });
  emit("close");
};

const showProjectDialog = (preserveError = false): void => {
  if (!preserveError) addError.value = null;
  projectDialog.value?.showModal();
  if (desktopDirectoryPickerAvailable()) {
    void nextTick(() => projectPathInput.value?.focus());
  }
};

const openAddProject = async (): Promise<void> => {
  paletteDialog.value?.close();
  addError.value = null;
  if (desktopDirectoryPickerAvailable()) {
    const selected = await selectDesktopProjectDirectory();
    if (selected === null) return;
    path.value = selected;
    name.value = "";
    if (await persistProject()) return;
    showProjectDialog(true);
    await nextTick();
    projectPathInput.value?.focus();
    return;
  }
  showProjectDialog();
  void browseDirectories();
};

const browseDirectories = async (nextPath?: string): Promise<void> => {
  browsing.value = true;
  browseError.value = null;
  try {
    directoryBrowser.value = await api.browseProjectDirectories(nextPath);
    path.value = directoryBrowser.value.currentPath;
    await nextTick();
    projectDialog.value?.querySelector<HTMLButtonElement>(".directory-browser li button")?.focus();
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
    projectDialog.value?.close();
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
  await nextTick();
  projectPathInput.value?.focus();
};

const openSettings = (): void => {
  paletteDialog.value?.close();
  theme.value = workspace.settings.theme;
  graphDensity.value = workspace.settings.graphDensity;
  settingsDialog.value?.showModal();
};

const saveSettings = async (): Promise<void> => {
  await workspace.saveSettings({
    ...workspace.settings,
    theme: theme.value,
    graphDensity: graphDensity.value,
  });
  settingsDialog.value?.close();
};

const onGlobalKeydown = (event: KeyboardEvent): void => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  if (event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    paletteDialog.value?.showModal();
  }
  if (event.key.toLocaleLowerCase() === "n") {
    event.preventDefault();
    void newChat();
  }
};

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

onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));
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
      <section v-for="project in visibleProjects" v-else :key="project.id" class="project-group">
        <div class="project-row" :class="{ active: routeProjectId === project.id }">
          <button
            class="project-name-button"
            type="button"
            :aria-label="$t('navigation.newChatInProject', { project: project.name })"
            @click="newChat(project.id)"
          >
            <span class="project-chevron" aria-hidden="true">⌄</span>
            <span class="project-folder" aria-hidden="true">▱</span>
            <strong>{{ project.name }}</strong>
          </button>
        </div>
        <ul v-if="threadsForProject(project.id).length > 0" class="thread-list">
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
      </section>
    </nav>

    <div class="sidebar-footer">
      <button type="button" @click="openSettings">
        <span aria-hidden="true">⚙</span> {{ $t("settings.title") }}
      </button>
    </div>
  </aside>

  <dialog
    ref="projectDialog"
    class="modal"
    aria-labelledby="add-project-title"
    @close="addError = null"
  >
    <form method="dialog" @submit.prevent="addProject">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">{{ $t("projects.add") }}</p>
          <h2 id="add-project-title">{{ $t("projects.chooseServerDirectory") }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Close"
          @click="projectDialog?.close()"
        >
          ×
        </button>
      </div>
      <div v-if="!desktopDirectoryPickerAvailable()" class="directory-browser" aria-live="polite">
        <div class="directory-browser-heading">
          <strong>{{ directoryBrowser?.currentPath ?? $t("projects.loadingDirectories") }}</strong>
          <button
            v-if="directoryBrowser?.parentPath"
            class="button secondary"
            type="button"
            :disabled="browsing"
            @click="browseDirectories(directoryBrowser.parentPath ?? undefined)"
          >
            {{ $t("projects.up") }}
          </button>
        </div>
        <div v-if="browsing" class="directory-loading">{{ $t("projects.loadingDirectories") }}</div>
        <div v-else-if="browseError" class="form-error" role="alert">
          {{ browseError }}
          <button class="button secondary" type="button" @click="browseDirectories()">Retry</button>
        </div>
        <ul v-else-if="directoryBrowser && directoryBrowser.entries.length > 0">
          <li v-for="entry in directoryBrowser.entries" :key="entry.path">
            <button type="button" @click="browseDirectories(entry.path)">
              <span aria-hidden="true">▣</span>{{ entry.name }}
            </button>
          </li>
        </ul>
        <p v-else-if="directoryBrowser" class="directory-empty">{{ $t("projects.noChildren") }}</p>
        <p class="directory-browser-note">{{ $t("projects.serverFolderCue") }}</p>
      </div>
      <label v-else>
        <span>{{ $t("projects.selectedPath") }}</span>
        <input ref="projectPathInput" v-model="path" required readonly />
        <button class="button secondary" type="button" @click="chooseDirectory">
          {{ $t("projects.anotherDirectory") }}
        </button>
        <small>{{ $t("projects.pathHint") }}</small>
      </label>
      <details v-if="!desktopDirectoryPickerAvailable()" class="advanced-fields manual-path-fields">
        <summary>{{ $t("projects.manualPath") }}</summary>
        <label>
          <span>{{ $t("projects.absoluteServerPath") }}</span>
          <input
            ref="projectPathInput"
            v-model="path"
            required
            autocomplete="off"
            placeholder="/srv/projects/example"
            :aria-invalid="addError ? 'true' : undefined"
            :aria-describedby="addError ? 'add-project-error' : 'project-path-hint'"
          />
          <small id="project-path-hint">{{ $t("projects.permittedPathHint") }}</small>
        </label>
      </details>
      <details class="advanced-fields">
        <summary>{{ $t("projects.advanced") }}</summary>
        <label>
          <span>{{ $t("projects.name") }}</span>
          <input v-model="name" autocomplete="off" :placeholder="$t('projects.inferredName')" />
        </label>
      </details>
      <p v-if="addError" id="add-project-error" class="form-error" role="alert">{{ addError }}</p>
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="projectDialog?.close()">
          {{ $t("common.cancel") }}
        </button>
        <button class="button primary" type="submit" :disabled="saving || path.trim().length === 0">
          {{ saving ? $t("projects.adding") : $t("projects.add") }}
        </button>
      </div>
    </form>
  </dialog>

  <dialog ref="paletteDialog" class="modal command-palette" aria-labelledby="palette-title">
    <div class="modal-heading">
      <div>
        <p class="eyebrow">{{ $t("navigation.workspace") }}</p>
        <h2 id="palette-title">{{ $t("navigation.palette") }}</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close" @click="paletteDialog?.close()">
        ×
      </button>
    </div>
    <div class="palette-actions">
      <button type="button" @click="newChat()">{{ $t("navigation.newChat") }}</button>
      <button type="button" @click="openAddProject">{{ $t("projects.add") }}</button>
      <button type="button" @click="openSettings">{{ $t("settings.open") }}</button>
    </div>
    <div v-if="visibleProjects.length > 1" class="palette-projects">
      <p>{{ $t("navigation.newChatIn") }}</p>
      <button
        v-for="project in visibleProjects"
        :key="project.id"
        type="button"
        @click="newChat(project.id)"
      >
        {{ project.name }}
      </button>
    </div>
  </dialog>

  <dialog ref="settingsDialog" class="modal" aria-labelledby="settings-title">
    <form method="dialog" @submit.prevent="saveSettings">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">{{ $t("settings.preferences") }}</p>
          <h2 id="settings-title">{{ $t("settings.title") }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="Close"
          @click="settingsDialog?.close()"
        >
          ×
        </button>
      </div>
      <label
        ><span>{{ $t("settings.theme") }}</span
        ><select v-model="theme">
          <option value="system">{{ $t("settings.system") }}</option>
          <option value="light">{{ $t("settings.light") }}</option>
          <option value="dark">{{ $t("settings.dark") }}</option>
        </select></label
      >
      <label
        ><span>{{ $t("settings.density") }}</span
        ><select v-model="graphDensity">
          <option value="comfortable">{{ $t("settings.comfortable") }}</option>
          <option value="compact">{{ $t("settings.compact") }}</option>
        </select></label
      >
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="settingsDialog?.close()">
          {{ $t("common.cancel") }}
        </button>
        <button class="button primary" type="submit">{{ $t("common.save") }}</button>
      </div>
    </form>
  </dialog>
</template>

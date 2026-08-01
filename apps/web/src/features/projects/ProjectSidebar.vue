<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useRoute, useRouter } from "vue-router";

import type { ProjectId } from "@metaclanker/contracts/ids";
import type { Provider } from "@metaclanker/contracts/wire";

import {
  desktopDirectoryPickerAvailable,
  selectDesktopProjectDirectory,
} from "../../shared/desktopBridge.js";
import { useWorkspaceStore } from "../../shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const route = useRoute();
const router = useRouter();
const dialog = useTemplateRef<HTMLDialogElement>("projectDialog");
const settingsDialog = useTemplateRef<HTMLDialogElement>("settingsDialog");
const path = ref("");
const name = ref("");
const saving = ref(false);
const addError = ref<string | null>(null);
const expandedProject = ref<ProjectId | null>(null);
const theme = ref(workspace.settings.theme);
const graphDensity = ref(workspace.settings.graphDensity);
const canChooseDirectory = desktopDirectoryPickerAvailable();

const visibleProjects = computed(() =>
  workspace.shell.projects
    .filter((project) => !project.hidden)
    .toSorted((a, b) => a.order - b.order),
);

const selectedThreadId = computed(() =>
  typeof route.params["threadId"] === "string" ? route.params["threadId"] : null,
);

const threadsFor = (projectId: ProjectId) =>
  workspace.shell.threads.filter((thread) => thread.projectId === projectId && !thread.archived);

const openAddProject = (): void => {
  addError.value = null;
  dialog.value?.showModal();
};

const addProject = async (): Promise<void> => {
  saving.value = true;
  addError.value = null;
  try {
    await workspace.createProject(path.value.trim(), name.value.trim());
    path.value = "";
    name.value = "";
    dialog.value?.close();
  } catch (cause) {
    addError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
};

const chooseDirectory = async (): Promise<void> => {
  const selected = await selectDesktopProjectDirectory();
  if (selected !== null) path.value = selected;
};

const newThread = async (projectId: ProjectId, provider: Provider): Promise<void> => {
  const threadId = await workspace.createThread(projectId, provider);
  expandedProject.value = null;
  await router.push({ name: "thread", params: { threadId } });
};

const openSettings = (): void => {
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
</script>

<template>
  <aside class="sidebar" aria-label="Project and thread navigation">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true">M</div>
      <div>
        <strong>{{ $t("app.name") }}</strong>
        <span>{{ $t("app.tagline") }}</span>
      </div>
    </div>

    <div class="sidebar-section-heading">
      <h2>{{ $t("projects.title") }}</h2>
      <button
        class="icon-button"
        type="button"
        :aria-label="$t('projects.add')"
        @click="openAddProject"
      >
        <span aria-hidden="true">＋</span>
      </button>
    </div>

    <p v-if="visibleProjects.length === 0" class="sidebar-empty">{{ $t("projects.empty") }}</p>

    <nav class="project-list" aria-label="Projects">
      <section
        v-for="project in visibleProjects"
        :key="project.id"
        class="project-group"
        :aria-label="`${project.name} project`"
      >
        <div class="project-heading">
          <span class="project-glyph" aria-hidden="true">⌁</span>
          <div class="project-label">
            <strong>{{ project.name }}</strong>
            <span>
              {{ project.gitBranch ?? "No Git" }}
              <i
                v-if="project.gitStatus === 'dirty'"
                class="dirty-mark"
                aria-label="Uncommitted changes"
                >•</i
              >
            </span>
          </div>
          <button
            class="icon-button subtle"
            type="button"
            :aria-label="$t('projects.createThread')"
            :aria-expanded="expandedProject === project.id"
            @click="expandedProject = expandedProject === project.id ? null : project.id"
          >
            <span aria-hidden="true">＋</span>
          </button>
        </div>

        <div
          v-if="expandedProject === project.id"
          class="provider-menu"
          aria-label="Choose provider"
        >
          <button type="button" @click="newThread(project.id, 'codex')">Codex</button>
          <button type="button" @click="newThread(project.id, 'claude')">Claude</button>
        </div>

        <ul class="thread-list">
          <li v-for="thread in threadsFor(project.id)" :key="thread.id">
            <RouterLink
              :to="{ name: 'thread', params: { threadId: thread.id } }"
              :class="{ active: selectedThreadId === thread.id }"
            >
              <span class="status-dot" :data-status="thread.status" aria-hidden="true" />
              <span>{{ thread.title }}</span>
              <small>{{ thread.provider }}</small>
            </RouterLink>
          </li>
        </ul>
      </section>
    </nav>

    <div class="sidebar-footer">
      <button type="button"><span aria-hidden="true">⌘</span> Command palette <kbd>⌘K</kbd></button>
      <button type="button" @click="openSettings">
        <span aria-hidden="true">⚙</span> Settings
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
          <h2 id="add-project-title">{{ $t("projects.addTitle") }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          :aria-label="$t('common.close')"
          @click="dialog?.close()"
        >
          ×
        </button>
      </div>
      <label>
        <span>{{ $t("projects.path") }}</span>
        <input
          v-model="path"
          required
          autocomplete="off"
          placeholder="/Users/you/Projects/example"
        />
        <button
          v-if="canChooseDirectory"
          class="button secondary"
          type="button"
          @click="chooseDirectory"
        >
          {{ $t("projects.browse") }}
        </button>
        <small>{{ $t("projects.pathHint") }}</small>
      </label>
      <label>
        <span>{{ $t("projects.name") }}</span>
        <input v-model="name" autocomplete="off" :placeholder="$t('projects.nameOptional')" />
      </label>
      <p v-if="addError" class="form-error" role="alert">{{ addError }}</p>
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="dialog?.close()">
          {{ $t("common.cancel") }}
        </button>
        <button class="button primary" type="submit" :disabled="saving || path.trim().length === 0">
          {{ saving ? $t("common.loading") : $t("projects.add") }}
        </button>
      </div>
    </form>
  </dialog>

  <dialog ref="settingsDialog" class="modal" aria-labelledby="settings-title">
    <form method="dialog" @submit.prevent="saveSettings">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">Preferences</p>
          <h2 id="settings-title">Workspace settings</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          :aria-label="$t('common.close')"
          @click="settingsDialog?.close()"
        >
          ×
        </button>
      </div>
      <label>
        <span>Theme</span>
        <select v-model="theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        <span>Graph node density</span>
        <select v-model="graphDensity">
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <div class="modal-actions">
        <button class="button secondary" type="button" @click="settingsDialog?.close()">
          {{ $t("common.cancel") }}
        </button>
        <button class="button primary" type="submit">{{ $t("common.save") }}</button>
      </div>
    </form>
  </dialog>
</template>

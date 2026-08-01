<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";

import { useWorkspaceStore } from "../shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const router = useRouter();
const projects = computed(() => workspace.shell.projects.filter((project) => !project.hidden));

const start = async (): Promise<void> => {
  const project = projects.value[0];
  if (project === undefined) {
    await router.push({ name: "home", query: { addProject: "true" } });
    return;
  }
  workspace.draftForProject(project.id);
  await router.push({ name: "draft", params: { projectId: project.id } });
};
</script>

<template>
  <section class="welcome-view" aria-labelledby="welcome-title">
    <h1 id="welcome-title">
      {{ projects.length === 0 ? $t("welcome.noProjectsTitle") : $t("welcome.readyTitle") }}
    </h1>
    <p>
      {{ projects.length === 0 ? $t("welcome.noProjectsBody") : $t("welcome.readyBody") }}
    </p>
    <div class="welcome-actions">
      <button class="button primary" type="button" @click="start">
        {{ projects.length === 0 ? $t("projects.add") : $t("navigation.newChat") }}
      </button>
      <button
        class="button secondary"
        type="button"
        @click="
          router.push({
            name: 'home',
            query: { settings: 'true' },
          })
        "
      >
        {{ $t("settings.open") }}
      </button>
    </div>
  </section>
</template>

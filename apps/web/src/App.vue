<script setup lang="ts">
import { onMounted } from "vue";
import { RouterView } from "vue-router";

import ProjectSidebar from "./features/projects/ProjectSidebar.vue";
import { useWorkspaceStore } from "./shared/workspaceStore.js";

const workspace = useWorkspaceStore();

onMounted(() => {
  void workspace.bootstrap();
});
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">{{ $t("accessibility.skipToContent") }}</a>
    <ProjectSidebar />
    <main id="main-content" class="main-surface" tabindex="-1">
      <div v-if="workspace.loading && workspace.shell.projects.length === 0" class="center-state">
        <div class="loading-mark" aria-hidden="true" />
        <p>{{ $t("common.loading") }}</p>
      </div>
      <div v-else-if="workspace.error" class="center-state" role="alert">
        <p>{{ workspace.error }}</p>
        <button class="button secondary" type="button" @click="workspace.bootstrap">
          {{ $t("common.retry") }}
        </button>
      </div>
      <RouterView v-else />
    </main>
  </div>
</template>

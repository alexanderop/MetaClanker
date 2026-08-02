<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterView } from "vue-router";

import ProjectSidebar from "./features/projects/ProjectSidebar.vue";
import { Button } from "./ui/button/index.js";
import { initialSidebarCollapsed, persistSidebarCollapsed } from "./shared/desktopBridge.js";
import { useWorkspaceStore } from "./shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const sidebarOpen = ref(false);
const sidebarCollapsed = ref(initialSidebarCollapsed());
const { retrying, retryMessage, retry } = useRecovery();

const centerStateClass =
  "grid h-full place-items-center content-center gap-3 text-center text-text-muted";

const toggleSidebarCollapse = (): void => {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  void persistSidebarCollapsed(sidebarCollapsed.value);
};

function useRecovery() {
  const retrying = ref(false);
  const retryMessage = ref<string | null>(null);

  const retry = async (): Promise<void> => {
    if (retrying.value) return;
    retrying.value = true;
    retryMessage.value = workspace.error;
    try {
      await workspace.retry();
    } finally {
      retrying.value = false;
      retryMessage.value = null;
    }
  };

  return { retrying, retryMessage, retry };
}

onMounted(() => {
  void workspace.bootstrap();
});

onBeforeUnmount(() => workspace.disconnect());
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <a class="skip-link" href="#main-content">{{ $t("accessibility.skipToContent") }}</a>
    <ProjectSidebar
      :open="sidebarOpen"
      :collapsed="sidebarCollapsed"
      @close="sidebarOpen = false"
      @toggle-collapse="toggleSidebarCollapse"
    />
    <button
      v-if="sidebarOpen"
      class="sidebar-scrim"
      type="button"
      :aria-label="$t('navigation.close')"
      @click="sidebarOpen = false"
    />
    <main id="main-content" class="main-surface" tabindex="-1">
      <button
        class="mobile-menu-button"
        type="button"
        :aria-label="$t('navigation.open')"
        :aria-expanded="sidebarOpen"
        @click="sidebarOpen = true"
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div
        v-if="workspace.loading && workspace.shell.projects.length === 0"
        :class="centerStateClass"
      >
        <div
          class="size-7 animate-spin rounded-full border-2 border-border border-t-accent-strong"
          aria-hidden="true"
        />
        <p>{{ $t("common.loading") }}</p>
      </div>
      <div v-else-if="retrying || workspace.error" :class="centerStateClass" role="alert">
        <p>{{ retryMessage ?? workspace.error }}</p>
        <Button variant="secondary" type="button" :disabled="retrying" @click="retry">
          {{ $t(retrying ? "common.retrying" : "common.retry") }}
        </Button>
      </div>
      <RouterView v-else />
    </main>
  </div>
</template>

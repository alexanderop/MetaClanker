<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { ThreadId } from "@metaclanker/contracts/ids";

import Composer from "../features/conversation/Composer.vue";
import ThreadHeader from "../features/conversation/ThreadHeader.vue";
import Transcript from "../features/conversation/Transcript.vue";
import ReviewPanel from "../features/conversation/ReviewPanel.vue";
import { useWorkspaceStore } from "../shared/workspaceStore.js";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceStore();
const AgentMap = defineAsyncComponent(() => import("../features/agent-map/AgentMap.vue"));
const reviewOpen = ref(false);

const surface = computed<"conversation" | "map">(() =>
  route.query["surface"] === "map" ? "map" : "conversation",
);

const threadId = computed(() =>
  typeof route.params["threadId"] === "string" ? ThreadId.make(route.params["threadId"]) : null,
);

watch(
  threadId,
  (id) => {
    if (id !== null) void workspace.loadThread(id);
  },
  { immediate: true },
);

const changeSurface = async (next: "conversation" | "map"): Promise<void> => {
  if (threadId.value === null) return;
  await router.replace({
    name: "thread",
    params: { threadId: threadId.value },
    query: next === "map" ? { surface: "map" } : {},
  });
};

onBeforeUnmount(() => {
  document.title = "MetaClanker";
});
</script>

<template>
  <div v-if="workspace.detail" class="workspace-view">
    <ThreadHeader
      :thread="workspace.detail.thread"
      :project="workspace.selectedProject"
      :surface="surface"
      :theme="workspace.resolvedTheme"
      @change-surface="changeSurface"
      @open-review="reviewOpen = true"
      @toggle-theme="workspace.toggleTheme"
    />
    <div v-show="surface === 'conversation'" class="contents">
      <Transcript :detail="workspace.detail" />
      <Composer :thread="workspace.detail.thread" />
    </div>
    <AgentMap v-if="surface === 'map'" :agent-nodes="workspace.detail.agentNodes" />
    <ReviewPanel
      v-if="reviewOpen"
      :thread-id="workspace.detail.thread.id"
      @close="reviewOpen = false"
      @restored="workspace.loadThread(workspace.detail.thread.id)"
    />
  </div>
</template>

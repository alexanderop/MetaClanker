<script setup lang="ts">
import type { Project, Thread } from "@metaclanker/contracts/wire";

defineProps<{
  thread: Thread;
  project: Project | null;
  surface: "conversation" | "map";
}>();

defineEmits<{
  changeSurface: [surface: "conversation" | "map"];
  openReview: [];
}>();
</script>

<template>
  <header class="thread-header">
    <div class="thread-identity">
      <div class="provider-avatar" :data-provider="thread.provider" aria-hidden="true">
        {{ thread.provider === "codex" ? "C" : "A" }}
      </div>
      <div>
        <div class="thread-title-row">
          <h1>{{ thread.title }}</h1>
          <span
            class="status-badge"
            :data-status="thread.status"
            role="status"
            :aria-label="`Thread status: ${thread.status}`"
          >
            <span aria-hidden="true" />{{ thread.status }}
          </span>
        </div>
        <p>
          <span>{{ thread.provider }}</span>
          <span v-if="thread.model">· {{ thread.model }}</span>
          <span v-if="project?.gitBranch">· {{ $t("thread.branch") }} {{ project.gitBranch }}</span>
          <span v-if="project?.gitStatus === 'unavailable'">· Git unavailable</span>
        </p>
      </div>
    </div>
    <div class="surface-switch" role="group" aria-label="Workspace surface">
      <button
        type="button"
        :aria-pressed="surface === 'conversation'"
        @click="$emit('changeSurface', 'conversation')"
      >
        <span aria-hidden="true">▤</span>{{ $t("thread.conversation") }}
      </button>
      <button
        type="button"
        :aria-pressed="surface === 'map'"
        @click="$emit('changeSurface', 'map')"
      >
        <span aria-hidden="true">⌘</span>{{ $t("thread.map") }}
      </button>
    </div>
    <button
      class="button secondary review-button"
      type="button"
      :disabled="project?.gitStatus === 'unavailable'"
      :title="
        project?.gitStatus === 'unavailable'
          ? 'Git review is unavailable for this project'
          : undefined
      "
      @click="$emit('openReview')"
    >
      <span aria-hidden="true">±</span>{{ $t("thread.review") }}
    </button>
  </header>
</template>

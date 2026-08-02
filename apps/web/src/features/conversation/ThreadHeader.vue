<script setup lang="ts">
import { computed } from "vue";

import type { Project, Thread } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
import { ProviderMark } from "../../ui/provider-mark/index.js";
import { StatusBadge } from "../../ui/status-badge/index.js";
import { ThemeToggle } from "../../ui/theme-toggle/index.js";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group/index.js";

const props = defineProps<{
  thread: Thread;
  project: Project | null;
  surface: "conversation" | "map";
  theme: "light" | "dark";
}>();

const emit = defineEmits<{
  changeSurface: [surface: "conversation" | "map"];
  openReview: [];
  toggleTheme: [];
}>();

// reka's single-selection group refuses to deselect the active item, so the model
// only ever hands back a surface the header already knows how to render.
const selectedSurface = computed({
  get: () => props.surface,
  set: (next) => emit("changeSurface", next),
});
</script>

<template>
  <header
    class="grid min-h-13 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 bg-canvas-glass px-4 py-1.5 backdrop-blur-lg max-narrow:grid-cols-[minmax(0,1fr)_auto]"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <ProviderMark :provider="thread.provider" size="sm">
        {{ thread.provider === "codex" ? "C" : "A" }}
      </ProviderMark>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span v-if="project" class="max-w-40 truncate text-base font-medium text-text-muted">
            {{ project.name }}
          </span>
          <span v-if="project" aria-hidden="true" class="text-text-muted/50">/</span>
          <h1
            class="m-0 overflow-hidden text-md font-semibold tracking-tight text-ellipsis whitespace-nowrap"
          >
            {{ thread.title }}
          </h1>
          <StatusBadge
            :status="thread.status"
            role="status"
            :aria-label="`Thread status: ${thread.status}`"
          >
            {{ thread.status }}
          </StatusBadge>
        </div>
        <p class="mt-0.5 mb-0 text-2xs text-text-muted capitalize max-narrow:hidden">
          <span>{{ thread.provider }}</span>
          <span v-if="thread.model">· {{ thread.model }}</span>
          <span v-if="project?.gitBranch">· {{ $t("thread.branch") }} {{ project.gitBranch }}</span>
          <span v-if="project?.gitStatus === 'unavailable'">· Git unavailable</span>
        </p>
      </div>
    </div>
    <ToggleGroup v-model="selectedSurface" aria-label="Workspace surface">
      <ToggleGroupItem value="conversation">
        <span aria-hidden="true">▤</span>{{ $t("thread.conversation") }}
      </ToggleGroupItem>
      <ToggleGroupItem value="map">
        <span aria-hidden="true">⌘</span>{{ $t("thread.map") }}
      </ToggleGroupItem>
    </ToggleGroup>
    <!--
      The trailing controls share one grid track so the header keeps the three
      columns its narrow-viewport fallback is written against.
    -->
    <div class="flex items-center gap-1.5">
      <ThemeToggle :theme="theme" @toggle="$emit('toggleTheme')" />
      <Button
        variant="secondary"
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
      </Button>
    </div>
  </header>
</template>

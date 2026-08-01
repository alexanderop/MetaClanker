<script setup lang="ts">
import { computed } from "vue";

import type { Project, Thread } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
import { ProviderMark } from "../../ui/provider-mark/index.js";
import { StatusBadge } from "../../ui/status-badge/index.js";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group/index.js";

const props = defineProps<{
  thread: Thread;
  project: Project | null;
  surface: "conversation" | "map";
}>();

const emit = defineEmits<{
  changeSurface: [surface: "conversation" | "map"];
  openReview: [];
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
    class="grid min-h-[4.5rem] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-[1.2rem] border-b border-border bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] px-[1.2rem] py-[0.7rem] backdrop-blur-[16px] max-narrow:grid-cols-[minmax(0,1fr)_auto]"
  >
    <div class="flex min-w-0 items-center gap-3">
      <ProviderMark :provider="thread.provider">
        {{ thread.provider === "codex" ? "C" : "A" }}
      </ProviderMark>
      <div class="min-w-0">
        <div class="flex items-center gap-[0.6rem]">
          <h1
            class="m-0 overflow-hidden text-[0.9rem] font-[680] tracking-[-0.015em] text-ellipsis whitespace-nowrap"
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
        <p class="mt-[0.2rem] mb-0 text-[0.65rem] text-text-muted capitalize max-narrow:hidden">
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
  </header>
</template>

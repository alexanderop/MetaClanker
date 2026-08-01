<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { RestorePreviewResponse, ReviewResponse } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
import { Eyebrow } from "../../ui/eyebrow/index.js";
import { FieldError } from "../../ui/field/index.js";
import { api } from "../../shared/apiClient.js";

const props = defineProps<{ threadId: ThreadId }>();
const emit = defineEmits<{ close: []; restored: [] }>();
const review = ref<ReviewResponse | null>(null);
const preview = ref<RestorePreviewResponse | null>(null);
const selectedCheckpointId = ref<string | null>(null);
const confirmed = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

const preTurnCheckpoints = computed(
  () => review.value?.checkpoints.filter((record) => record.kind === "pre-turn").toReversed() ?? [],
);

const previewRows = computed(() => [
  { label: "Files added back", value: preview.value?.additions.length ?? 0 },
  { label: "Files overwritten", value: preview.value?.modifications.length ?? 0 },
  { label: "Files deleted", value: preview.value?.deletions.length ?? 0 },
  { label: "Ignored files covered", value: preview.value?.includesIgnoredFiles ? "Yes" : "No" },
]);

const sectionHeadingClass = "m-0 mb-[0.65rem] flex items-center justify-between text-[0.75rem]";
const proseClass = "mt-[0.35rem] mb-[0.8rem] text-[0.68rem] leading-[1.55] text-text-muted";
const previewRowClass = "flex justify-between gap-4 text-[0.63rem]";

onMounted(async () => {
  busy.value = true;
  try {
    review.value = await api.review(props.threadId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
});

const selectCheckpoint = async (checkpointId: string): Promise<void> => {
  busy.value = true;
  error.value = null;
  confirmed.value = false;
  try {
    selectedCheckpointId.value = checkpointId;
    preview.value = await api.restorePreview(props.threadId, checkpointId);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
};

const restore = async (): Promise<void> => {
  if (!confirmed.value || selectedCheckpointId.value === null) return;
  busy.value = true;
  try {
    await api.restoreFiles(props.threadId, selectedCheckpointId.value);
    emit("restored");
    emit("close");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <aside
    class="fixed inset-y-0 right-0 z-20 w-[min(27rem,calc(100vw-var(--sidebar-width)))] overflow-y-auto border-l border-border bg-surface p-4 shadow-[var(--shadow-popover)]"
    aria-labelledby="review-title"
  >
    <div class="flex items-start justify-between gap-4 border-b border-border pb-[0.8rem]">
      <div>
        <Eyebrow>Git checkpoints</Eyebrow>
        <h2 id="review-title" class="mt-[0.15rem] mb-0 text-[1.05rem]">Review changes</h2>
      </div>
      <Button
        variant="outline"
        size="icon"
        type="button"
        aria-label="Close review"
        @click="$emit('close')"
      >
        ×
      </Button>
    </div>

    <div v-if="busy && review === null" :class="proseClass">Loading checkpoints…</div>
    <FieldError v-if="error">{{ error }}</FieldError>

    <template v-if="review">
      <section class="border-b border-border-subtle py-4">
        <h3 :class="sectionHeadingClass">
          Latest turn diff
          <span
            class="rounded-full bg-canvas px-[0.4rem] py-[0.15rem] text-[0.6rem] text-text-muted"
          >
            {{ review.diff.files.length }}
          </span>
        </h3>
        <p v-if="review.diff.files.length === 0" :class="proseClass">No file changes captured.</p>
        <ul class="m-0 grid list-none gap-[0.2rem] p-0">
          <li
            v-for="file in review.diff.files"
            :key="file.path"
            class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.55rem] rounded-xs p-2 font-mono text-[0.63rem] hover:bg-surface-raised"
          >
            <span
              class="grid size-5 place-items-center rounded-xs bg-info font-[800] text-accent-ink data-[status=added]:bg-accent data-[status=deleted]:bg-danger data-[status=deleted]:text-text-inverse"
              :data-status="file.status"
              >{{ file.status.slice(0, 1).toUpperCase() }}</span
            >
            <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ file.path }}</span>
            <small class="text-text-muted">{{ file.afterSize }} B</small>
          </li>
        </ul>
      </section>

      <section class="border-b border-border-subtle py-4">
        <h3 :class="sectionHeadingClass">Restore files</h3>
        <p :class="proseClass">
          Choose a pre-turn checkpoint. This restores workspace files only; it does not rewind the
          provider conversation.
        </p>
        <div class="grid gap-[0.35rem]">
          <button
            v-for="record in preTurnCheckpoints"
            :key="record.checkpoint.id"
            type="button"
            class="grid cursor-pointer grid-cols-[1fr_auto] gap-x-2 gap-y-[0.15rem] rounded-sm border border-border bg-surface-raised p-[0.6rem] text-left text-text aria-pressed:border-accent-strong aria-pressed:shadow-ring-sm"
            :aria-pressed="selectedCheckpointId === record.checkpoint.id"
            @click="selectCheckpoint(record.checkpoint.id)"
          >
            <span class="text-[0.68rem] font-bold">Before turn</span>
            <time :datetime="record.checkpoint.createdAt" class="text-[0.58rem] text-text-muted">{{
              new Date(record.checkpoint.createdAt).toLocaleString()
            }}</time>
            <small class="col-span-full text-[0.58rem] text-text-muted">
              {{ record.checkpoint.files.length }} files
            </small>
          </button>
        </div>
      </section>

      <section
        v-if="preview"
        class="mt-4 rounded-md border border-[color-mix(in_srgb,var(--color-danger)_50%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-danger)_5%,var(--color-surface))] p-[0.85rem]"
      >
        <h3 :class="sectionHeadingClass">Destructive preview</h3>
        <dl class="m-0 mb-[0.7rem] grid gap-[0.35rem]">
          <div v-for="row in previewRows" :key="row.label" :class="previewRowClass">
            <dt class="text-text-muted">{{ row.label }}</dt>
            <dd class="m-0 font-bold">{{ row.value }}</dd>
          </div>
        </dl>
        <details class="my-[0.65rem] text-[0.62rem] text-text-muted">
          <summary class="cursor-pointer">Show affected paths</summary>
          <ul
            class="m-0 mt-[0.45rem] grid max-h-32 list-none gap-[0.2rem] overflow-y-auto p-0 font-mono"
          >
            <li
              v-for="file in [...preview.additions, ...preview.modifications, ...preview.deletions]"
              :key="file.path"
            >
              {{ file.path }} <small>({{ file.kind }})</small>
            </li>
          </ul>
        </details>
        <label
          class="my-3 grid grid-cols-[auto_1fr] items-start gap-2 text-[0.65rem] leading-[1.45]"
        >
          <input v-model="confirmed" type="checkbox" />
          <span>I understand this overwrites current files and creates an undo checkpoint.</span>
        </label>
        <Button variant="danger" type="button" :disabled="!confirmed || busy" @click="restore">
          Restore files
        </Button>
      </section>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { CommandId, type ThreadId } from "@metaclanker/contracts/ids";
import type { RestorePreviewResponse, ReviewResponse } from "@metaclanker/contracts/wire";

import { Button } from "../../ui/button/index.js";
import { Eyebrow } from "../../ui/eyebrow/index.js";
import { FieldError } from "../../ui/field/index.js";
import { api } from "../../shared/apiClient.js";

const props = defineProps<{ threadId: ThreadId }>();
const emit = defineEmits<{ close: []; restored: [] }>();

const { busy, error, run } = useAsyncTask();
const { review, preTurnCheckpoints } = useCheckpoints();
const { preview, previewRows, selectedCheckpointId, confirmed, selectCheckpoint, restore } =
  useRestore();

// Every request in this panel shares one busy flag and one error slot, because
// the panel only ever runs one of them at a time.
function useAsyncTask() {
  const busy = ref(false);
  const error = ref<string | null>(null);

  const run = async <T>(operation: () => Promise<T>): Promise<T | null> => {
    busy.value = true;
    error.value = null;
    try {
      return await operation();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return null;
    } finally {
      busy.value = false;
    }
  };

  return { busy, error, run };
}

function useCheckpoints() {
  const review = ref<ReviewResponse | null>(null);

  const preTurnCheckpoints = computed(
    () =>
      review.value?.checkpoints.filter((record) => record.kind === "pre-turn").toReversed() ?? [],
  );

  onMounted(async () => {
    review.value = await run(() => api.review(props.threadId));
  });

  return { review, preTurnCheckpoints };
}

function useRestore() {
  const preview = ref<RestorePreviewResponse | null>(null);
  const selectedCheckpointId = ref<string | null>(null);
  const confirmed = ref(false);

  const previewRows = computed(() => [
    { label: "Files added back", value: preview.value?.additions.length ?? 0 },
    { label: "Files overwritten", value: preview.value?.modifications.length ?? 0 },
    { label: "Files deleted", value: preview.value?.deletions.length ?? 0 },
    { label: "Ignored files covered", value: preview.value?.includesIgnoredFiles ? "Yes" : "No" },
  ]);

  const selectCheckpoint = async (checkpointId: string): Promise<void> => {
    confirmed.value = false;
    selectedCheckpointId.value = checkpointId;
    preview.value = await run(() => api.restorePreview(props.threadId, checkpointId));
  };

  // Restoring is destructive, so it needs both a preview and an explicit tick.
  const restore = async (): Promise<void> => {
    const checkpointId = selectedCheckpointId.value;
    if (!confirmed.value || checkpointId === null) return;
    const restored = await run(() =>
      api.restoreFiles(props.threadId, {
        commandId: CommandId.make(crypto.randomUUID()),
        checkpointId,
        confirmed: true,
      }),
    );
    if (restored === null) return;
    emit("restored");
    emit("close");
  };

  return { preview, previewRows, selectedCheckpointId, confirmed, selectCheckpoint, restore };
}

const sectionHeadingClass = "m-0 mb-2.5 flex items-center justify-between text-base";
const proseClass = "mt-1.5 mb-3 text-sm leading-normal text-text-muted";
const previewRowClass = "flex justify-between gap-4 text-xs";
</script>

<template>
  <aside
    class="fixed inset-y-0 right-0 z-20 w-[min(27rem,calc(100vw-var(--sidebar-width)))] overflow-y-auto border-l border-border bg-surface p-4 shadow-popover"
    aria-labelledby="review-title"
  >
    <div class="flex items-start justify-between gap-4 border-b border-border pb-3">
      <div>
        <Eyebrow>Git checkpoints</Eyebrow>
        <h2 id="review-title" class="mt-0.5 mb-0 text-xl">Review changes</h2>
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
          <span class="rounded-full bg-canvas px-1.5 py-0.5 text-2xs text-text-muted">
            {{ review.diff.files.length }}
          </span>
        </h3>
        <p v-if="review.diff.files.length === 0" :class="proseClass">No file changes captured.</p>
        <ul class="m-0 grid list-none gap-1 p-0">
          <li
            v-for="file in review.diff.files"
            :key="file.path"
            class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xs p-2 font-mono text-xs hover:bg-surface-raised"
          >
            <span
              class="grid size-5 place-items-center rounded-xs bg-info font-extrabold text-accent-ink data-[status=added]:bg-accent data-[status=deleted]:bg-danger data-[status=deleted]:text-text-inverse"
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
        <div class="grid gap-1.5">
          <button
            v-for="record in preTurnCheckpoints"
            :key="record.checkpoint.id"
            type="button"
            class="grid cursor-pointer grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 rounded-sm border border-border bg-surface-raised p-2.5 text-left text-text aria-pressed:border-accent-strong aria-pressed:shadow-ring-sm"
            :aria-pressed="selectedCheckpointId === record.checkpoint.id"
            @click="selectCheckpoint(record.checkpoint.id)"
          >
            <span class="text-sm font-bold">Before turn</span>
            <time :datetime="record.checkpoint.createdAt" class="text-2xs text-text-muted">{{
              new Date(record.checkpoint.createdAt).toLocaleString()
            }}</time>
            <small class="col-span-full text-2xs text-text-muted">
              {{ record.checkpoint.files.length }} files
            </small>
          </button>
        </div>
      </section>

      <section v-if="preview" class="mt-4 rounded-md border border-danger-rim bg-danger-tint p-3.5">
        <h3 :class="sectionHeadingClass">Destructive preview</h3>
        <dl class="m-0 mb-3 grid gap-1.5">
          <div v-for="row in previewRows" :key="row.label" :class="previewRowClass">
            <dt class="text-text-muted">{{ row.label }}</dt>
            <dd class="m-0 font-bold">{{ row.value }}</dd>
          </div>
        </dl>
        <details class="my-2.5 text-xs text-text-muted">
          <summary class="cursor-pointer">Show affected paths</summary>
          <ul class="m-0 mt-2 grid max-h-32 list-none gap-1 overflow-y-auto p-0 font-mono">
            <li
              v-for="file in [...preview.additions, ...preview.modifications, ...preview.deletions]"
              :key="file.path"
            >
              {{ file.path }} <small>({{ file.kind }})</small>
            </li>
          </ul>
        </details>
        <label class="my-3 grid grid-cols-[auto_1fr] items-start gap-2 text-xs leading-normal">
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

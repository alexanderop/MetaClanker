<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { RestorePreviewResponse, ReviewResponse } from "@metaclanker/contracts/wire";

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
  <aside class="review-panel" aria-labelledby="review-title">
    <div class="review-heading">
      <div>
        <p class="eyebrow">Git checkpoints</p>
        <h2 id="review-title">Review changes</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close review" @click="$emit('close')">
        ×
      </button>
    </div>

    <div v-if="busy && review === null" class="review-state">Loading checkpoints…</div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <template v-if="review">
      <section class="review-section">
        <h3>
          Latest turn diff <span>{{ review.diff.files.length }}</span>
        </h3>
        <p v-if="review.diff.files.length === 0" class="review-state">No file changes captured.</p>
        <ul class="diff-file-list">
          <li v-for="file in review.diff.files" :key="file.path">
            <span class="diff-kind" :data-status="file.status">{{
              file.status.slice(0, 1).toUpperCase()
            }}</span>
            <span>{{ file.path }}</span>
            <small>{{ file.afterSize }} B</small>
          </li>
        </ul>
      </section>

      <section class="review-section">
        <h3>Restore files</h3>
        <p>
          Choose a pre-turn checkpoint. This restores workspace files only; it does not rewind the
          provider conversation.
        </p>
        <div class="checkpoint-list">
          <button
            v-for="record in preTurnCheckpoints"
            :key="record.checkpoint.id"
            type="button"
            :aria-pressed="selectedCheckpointId === record.checkpoint.id"
            @click="selectCheckpoint(record.checkpoint.id)"
          >
            <span>Before turn</span>
            <time :datetime="record.checkpoint.createdAt">{{
              new Date(record.checkpoint.createdAt).toLocaleString()
            }}</time>
            <small>{{ record.checkpoint.files.length }} files</small>
          </button>
        </div>
      </section>

      <section v-if="preview" class="restore-preview">
        <h3>Destructive preview</h3>
        <dl>
          <div>
            <dt>Files added back</dt>
            <dd>{{ preview.additions.length }}</dd>
          </div>
          <div>
            <dt>Files overwritten</dt>
            <dd>{{ preview.modifications.length }}</dd>
          </div>
          <div>
            <dt>Files deleted</dt>
            <dd>{{ preview.deletions.length }}</dd>
          </div>
          <div>
            <dt>Ignored files covered</dt>
            <dd>{{ preview.includesIgnoredFiles ? "Yes" : "No" }}</dd>
          </div>
        </dl>
        <details>
          <summary>Show affected paths</summary>
          <ul>
            <li
              v-for="file in [...preview.additions, ...preview.modifications, ...preview.deletions]"
              :key="file.path"
            >
              {{ file.path }} <small>({{ file.kind }})</small>
            </li>
          </ul>
        </details>
        <label class="confirmation-check">
          <input v-model="confirmed" type="checkbox" />
          <span>I understand this overwrites current files and creates an undo checkpoint.</span>
        </label>
        <button class="button danger" type="button" :disabled="!confirmed || busy" @click="restore">
          Restore files
        </button>
      </section>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUpdated, ref, useTemplateRef, watch } from "vue";

import type { ThreadDetail } from "@metaclanker/contracts/wire";

import { renderMarkdown } from "../../shared/markdown.js";
import PermissionCard from "./PermissionCard.vue";
import { conversationTimeline, timelineEntryKey } from "./timeline.js";
import { Card } from "../../ui/card/index.js";
import { EmptyState } from "../../ui/empty-state/index.js";

// Provider output is untrusted text of unbounded width, so a code block scrolls and
// wraps inside a bounded box rather than stretching the transcript column.
const codeBlockClass =
  "m-0 mx-3 mb-3 max-h-56 overflow-auto rounded-xs bg-sidebar p-3 font-mono text-[0.75em] whitespace-pre-wrap text-text-inverse";

// A reader scrolled this close to the end still counts as reading the tail.
const bottomAnchorSlack = 96;
const activityPageSize = 200;

const props = defineProps<{ detail: ThreadDetail }>();

const timeline = computed(() => conversationTimeline(props.detail));
const pendingInteractions = computed(() =>
  props.detail.interactions.filter(
    (interaction) => interaction.status === "pending" || interaction.status === "dispatching",
  ),
);
const cacheMarkdown = computed(() => props.detail.thread.status !== "running");

const { transcript, onScroll, keepScrollPosition } = useStickyScroll();
const { visibleTimeline, hiddenActivityCount, showEarlierActivity } = usePagedTimeline();

// Follows a running conversation, but yields the moment the reader scrolls up.
function useStickyScroll() {
  const transcript = useTemplateRef<HTMLElement>("transcript");
  let anchoredToBottom = true;

  const scrollToBottom = (): void => {
    const element = transcript.value;
    if (element !== null) element.scrollTop = element.scrollHeight;
  };

  const onScroll = (): void => {
    const element = transcript.value;
    if (element === null) return;
    anchoredToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < bottomAnchorSlack;
  };

  // Growing the list upwards must not move the entry the reader is looking at.
  const keepScrollPosition = (grow: () => void): void => {
    const element = transcript.value;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    grow();
    anchoredToBottom = false;
    void nextTick(() => {
      const next = transcript.value;
      if (next !== null) next.scrollTop = previousTop + next.scrollHeight - previousHeight;
    });
  };

  watch(
    () => props.detail.thread.id,
    () => {
      anchoredToBottom = true;
      void nextTick(scrollToBottom);
    },
  );

  onMounted(() => {
    void nextTick(scrollToBottom);
  });

  onUpdated(() => {
    if (!anchoredToBottom) return;
    void nextTick(scrollToBottom);
  });

  return { transcript, onScroll, keepScrollPosition };
}

// Long threads render a page at a time; the reader opts into older activity.
function usePagedTimeline() {
  const visibleActivityCount = ref(activityPageSize);

  const visibleTimeline = computed(() => timeline.value.slice(-visibleActivityCount.value));
  const hiddenActivityCount = computed(() => timeline.value.length - visibleTimeline.value.length);

  const showEarlierActivity = (): void => {
    keepScrollPosition(() => {
      visibleActivityCount.value += activityPageSize;
    });
  };

  watch(
    () => props.detail.thread.id,
    () => {
      visibleActivityCount.value = activityPageSize;
    },
  );

  return { visibleTimeline, hiddenActivityCount, showEarlierActivity };
}
</script>

<template>
  <section
    ref="transcript"
    class="min-h-0 overflow-y-auto px-[max(1rem,calc((100%-48rem)/2))] pt-8 pb-10"
    aria-label="Conversation transcript"
    @scroll="onScroll"
  >
    <EmptyState
      v-if="timeline.length === 0 && pendingInteractions.length === 0"
      glyph="✦"
      class="min-h-full"
    >
      <p>{{ $t("thread.noMessages") }}</p>
    </EmptyState>
    <button
      v-if="hiddenActivityCount > 0"
      type="button"
      class="mx-auto mb-5 block rounded-sm border border-border bg-surface px-3 py-2 text-base text-text-muted hover:text-text"
      @click="showEarlierActivity"
    >
      Show {{ Math.min(activityPageSize, hiddenActivityCount) }} earlier activities
    </button>
    <template v-for="entry in visibleTimeline" :key="timelineEntryKey(entry)">
      <article
        v-if="entry.kind === 'message'"
        class="w-full min-w-0 [&+&]:mt-4"
        style="content-visibility: auto; contain-intrinsic-size: auto 96px"
        :class="entry.message.role === 'user' ? 'message-user' : undefined"
        :aria-label="`${entry.message.role} message`"
      >
        <div
          class="min-w-0"
          :class="
            entry.message.role === 'user'
              ? 'ml-auto max-w-[80%] rounded-xl bg-surface-raised px-3 py-2.5'
              : 'px-1 py-0.5'
          "
        >
          <details
            v-if="entry.message.role === 'thought'"
            class="mt-1 border-l-2 border-border pl-3 text-text-muted"
          >
            <summary class="w-fit cursor-pointer text-sm text-text-muted">Thought summary</summary>
            <div class="markdown" v-html="renderMarkdown(entry.message.content, cacheMarkdown)" />
          </details>
          <div
            v-else
            class="markdown"
            v-html="renderMarkdown(entry.message.content, cacheMarkdown)"
          />
        </div>
      </article>

      <Card
        v-else
        as="details"
        class="mt-4"
        style="content-visibility: auto; contain-intrinsic-size: auto 64px"
        :aria-label="$t('thread.activity')"
      >
        <summary
          class="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 [&::-webkit-details-marker]:hidden"
        >
          <span
            class="grid size-7 place-items-center rounded-xs bg-canvas font-mono text-sm text-text-muted"
            aria-hidden="true"
            >{{ entry.toolCall.kind === "edit" ? "±" : "›_" }}</span
          >
          <span
            ><strong class="block text-sm">{{ entry.toolCall.title }}</strong
            ><small class="mt-0.5 block text-2xs text-text-muted capitalize">{{
              entry.toolCall.kind
            }}</small></span
          >
          <span
            class="text-2xs text-text-muted capitalize data-[status=completed]:text-accent-strong data-[status=failed]:text-danger"
            :data-status="entry.toolCall.status"
            >{{ entry.toolCall.status }}</span
          >
        </summary>
        <pre v-if="entry.toolCall.content" :class="codeBlockClass">{{
          entry.toolCall.content
        }}</pre>
      </Card>
    </template>

    <PermissionCard
      v-for="interaction in pendingInteractions"
      :key="interaction.id"
      :interaction="interaction"
    />

    <div class="sr-only" aria-live="polite" aria-atomic="true">
      {{ detail.thread.status === "completed" ? "Agent turn completed" : "" }}
    </div>
  </section>
</template>

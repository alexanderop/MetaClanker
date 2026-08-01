<script setup lang="ts">
import { computed, nextTick, onUpdated, useTemplateRef } from "vue";

import type { ThreadDetail } from "@metaclanker/contracts/wire";

import { renderMarkdown } from "../../shared/markdown.js";
import PermissionCard from "./PermissionCard.vue";
import { Card } from "../../ui/card/index.js";
import { EmptyState } from "../../ui/empty-state/index.js";

// Provider output is untrusted text of unbounded width, so a code block scrolls and
// wraps inside a bounded box rather than stretching the transcript column.
const codeBlockClass =
  "m-0 mx-3 mb-3 max-h-[14rem] overflow-auto rounded-xs bg-sidebar p-3 font-mono text-[0.75em] whitespace-pre-wrap text-text-inverse";

const props = defineProps<{ detail: ThreadDetail }>();
const transcript = useTemplateRef<HTMLElement>("transcript");
let anchoredToBottom = true;

const pendingInteractions = computed(() =>
  props.detail.interactions.filter((interaction) => interaction.status === "pending"),
);

const onScroll = (): void => {
  const element = transcript.value;
  if (element === null) return;
  anchoredToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
};

onUpdated(() => {
  if (!anchoredToBottom) return;
  void nextTick(() => transcript.value?.scrollTo({ top: transcript.value.scrollHeight }));
});
</script>

<template>
  <section
    ref="transcript"
    class="min-h-0 overflow-y-auto scroll-smooth px-[max(1.3rem,calc((100%-52rem)/2))] pt-[2.2rem] pb-12"
    aria-label="Conversation transcript"
    @scroll="onScroll"
  >
    <EmptyState v-if="detail.messages.length === 0" glyph="✦" class="min-h-full">
      <p>{{ $t("thread.noMessages") }}</p>
    </EmptyState>
    <article
      v-for="message in detail.messages"
      :key="message.id"
      class="grid w-full grid-cols-[2.1rem_minmax(0,1fr)] gap-3 [&+&]:mt-[1.6rem]"
      :class="message.role === 'user' ? 'message-user' : undefined"
      :aria-label="`${message.role} message`"
    >
      <div
        class="grid size-8 place-items-center rounded-sm border border-border bg-surface text-[0.58rem] font-[750] text-text-muted [.message-user_&]:bg-text [.message-user_&]:text-surface"
        aria-hidden="true"
      >
        {{ message.role === "user" ? "You" : message.role === "agent" ? "AI" : "··" }}
      </div>
      <div class="min-w-0">
        <div class="flex min-h-[1.55rem] items-center gap-2">
          <strong class="text-[0.72rem] capitalize">{{
            message.role === "user"
              ? "You"
              : message.role === "agent"
                ? detail.thread.provider
                : message.role
          }}</strong>
          <time :datetime="message.createdAt" class="text-[0.6rem] text-text-muted">{{
            new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}</time>
        </div>
        <details
          v-if="message.role === 'thought'"
          class="mt-1 border-l-2 border-border pl-3 text-text-muted"
        >
          <summary class="w-fit cursor-pointer text-[0.7rem] text-text-muted">
            Thought summary
          </summary>
          <div class="markdown" v-html="renderMarkdown(message.content)" />
        </details>
        <div v-else class="markdown" v-html="renderMarkdown(message.content)" />
      </div>
    </article>

    <section
      v-if="detail.toolCalls.length"
      class="mt-[1.4rem] ml-[2.85rem] grid gap-[0.45rem]"
      :aria-label="$t('thread.activity')"
    >
      <Card v-for="tool in detail.toolCalls" :key="tool.id" as="details">
        <summary
          class="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.65rem] px-3 py-[0.65rem] [&::-webkit-details-marker]:hidden"
        >
          <span
            class="grid size-[1.8rem] place-items-center rounded-xs bg-canvas font-mono text-[0.68rem] text-text-muted"
            aria-hidden="true"
            >{{ tool.kind === "edit" ? "±" : "›_" }}</span
          >
          <span
            ><strong class="block text-[0.7rem]">{{ tool.title }}</strong
            ><small class="mt-[0.1rem] block text-[0.58rem] text-text-muted capitalize">{{
              tool.kind
            }}</small></span
          >
          <span
            class="text-[0.6rem] text-text-muted capitalize data-[status=completed]:text-accent-strong data-[status=failed]:text-danger"
            :data-status="tool.status"
            >{{ tool.status }}</span
          >
        </summary>
        <pre v-if="tool.content" :class="codeBlockClass">{{ tool.content }}</pre>
      </Card>
    </section>

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

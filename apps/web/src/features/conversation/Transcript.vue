<script setup lang="ts">
import { computed, nextTick, onUpdated, useTemplateRef } from "vue";

import type { ThreadDetail } from "@metaclanker/contracts/wire";

import { renderMarkdown } from "../../shared/markdown.js";
import PermissionCard from "./PermissionCard.vue";

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
    class="transcript"
    aria-label="Conversation transcript"
    @scroll="onScroll"
  >
    <div v-if="detail.messages.length === 0" class="transcript-empty">
      <span aria-hidden="true">✦</span>
      <p>{{ $t("thread.noMessages") }}</p>
    </div>
    <article
      v-for="message in detail.messages"
      :key="message.id"
      class="message"
      :class="`message-${message.role}`"
      :aria-label="`${message.role} message`"
    >
      <div class="message-avatar" aria-hidden="true">
        {{ message.role === "user" ? "You" : message.role === "agent" ? "AI" : "··" }}
      </div>
      <div class="message-body">
        <div class="message-meta">
          <strong>{{
            message.role === "user"
              ? "You"
              : message.role === "agent"
                ? detail.thread.provider
                : message.role
          }}</strong>
          <time :datetime="message.createdAt">{{
            new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }}</time>
        </div>
        <details v-if="message.role === 'thought'" class="thought">
          <summary>Thought summary</summary>
          <div class="markdown" v-html="renderMarkdown(message.content)" />
        </details>
        <div v-else class="markdown" v-html="renderMarkdown(message.content)" />
      </div>
    </article>

    <section
      v-if="detail.toolCalls.length"
      class="activity-stack"
      :aria-label="$t('thread.activity')"
    >
      <details v-for="tool in detail.toolCalls" :key="tool.id" class="tool-card">
        <summary>
          <span class="tool-icon" aria-hidden="true">{{ tool.kind === "edit" ? "±" : "›_" }}</span>
          <span
            ><strong>{{ tool.title }}</strong
            ><small>{{ tool.kind }}</small></span
          >
          <span class="tool-status" :data-status="tool.status">{{ tool.status }}</span>
        </summary>
        <pre v-if="tool.content">{{ tool.content }}</pre>
      </details>
    </section>

    <PermissionCard
      v-for="interaction in pendingInteractions"
      :key="interaction.id"
      :interaction="interaction"
    />

    <div class="stream-announcer" aria-live="polite" aria-atomic="true">
      {{ detail.thread.status === "completed" ? "Agent turn completed" : "" }}
    </div>
  </section>
</template>

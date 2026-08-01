import type { Message, ToolCall } from "@metaclanker/contracts/wire";

export type ConversationTimelineEntry =
  | { readonly kind: "message"; readonly sequence: number; readonly message: Message }
  | { readonly kind: "tool"; readonly sequence: number; readonly toolCall: ToolCall };

export const timelineEntryKey = (entry: ConversationTimelineEntry): string =>
  entry.kind === "message" ? `message:${entry.message.id}` : `tool:${entry.toolCall.id}`;

export const conversationTimeline = (input: {
  readonly messages: ReadonlyArray<Message>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
}): ReadonlyArray<ConversationTimelineEntry> =>
  [
    ...input.messages.map(
      (message): ConversationTimelineEntry => ({
        kind: "message",
        sequence: message.sequence,
        message,
      }),
    ),
    ...input.toolCalls.map(
      (toolCall): ConversationTimelineEntry => ({
        kind: "tool",
        sequence: toolCall.sequence,
        toolCall,
      }),
    ),
  ].toSorted(
    (left, right) =>
      left.sequence - right.sequence ||
      timelineEntryKey(left).localeCompare(timelineEntryKey(right)),
  );

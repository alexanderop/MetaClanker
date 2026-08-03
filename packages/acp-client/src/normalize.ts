import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { NormalizedAgentEvent } from "@metaclanker/application/ports";
import { ToolCallId } from "@metaclanker/contracts/ids";
import type { Provider } from "@metaclanker/contracts/wire";

const CodexSubagent = Schema.Struct({
  threadId: Schema.String,
  path: Schema.optionalKey(Schema.String),
  activity: Schema.optionalKey(Schema.Literals(["started", "interacted", "interrupted"])),
});

const ClaudeSubagent = Schema.Struct({
  subagent: Schema.Boolean,
  parentToolUseId: Schema.optionalKey(Schema.String),
});

export type SubagentMetadata =
  | {
      readonly provider: "codex";
      readonly threadId: string;
      readonly path: string | null;
      readonly activity: "started" | "interacted" | "interrupted";
    }
  | {
      readonly provider: "claude";
      readonly parentToolUseId: string | null;
    };

export type SubagentMetadataDecode =
  | { readonly status: "absent" }
  | { readonly status: "invalid" }
  | { readonly status: "decoded"; readonly metadata: SubagentMetadata };

const recordValue = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return Reflect.get(value, key);
};

export const decodeSubagentMetadata = (
  provider: Provider,
  meta: Readonly<Record<string, unknown>> | null | undefined,
): SubagentMetadataDecode => {
  if (provider === "codex") {
    const candidate = recordValue(recordValue(meta, "codex"), "subagent");
    if (candidate === undefined) return { status: "absent" };
    const decoded = Schema.decodeUnknownOption(CodexSubagent)(candidate);
    if (Option.isNone(decoded)) {
      return { status: "invalid" };
    }
    return {
      status: "decoded",
      metadata: {
        provider: "codex",
        threadId: decoded.value.threadId,
        path: decoded.value.path ?? null,
        activity: decoded.value.activity ?? "interacted",
      },
    };
  }

  const candidate = recordValue(meta, "claudeCode");
  if (candidate === undefined) return { status: "absent" };
  const decoded = Schema.decodeUnknownOption(ClaudeSubagent)(candidate);
  if (Option.isNone(decoded)) {
    return { status: "invalid" };
  }
  if (!decoded.value.subagent) return { status: "absent" };
  return {
    status: "decoded",
    metadata: {
      provider: "claude",
      parentToolUseId: decoded.value.parentToolUseId ?? null,
    },
  };
};

const contentText = (content: ToolCallContent): string => {
  if (content.type === "content" && content.content.type === "text") {
    return content.content.text;
  }
  if (content.type === "diff") {
    return `${content.path}\n${content.oldText ?? ""}\n${content.newText}`;
  }
  if (content.type === "terminal") {
    return `Terminal ${content.terminalId}`;
  }
  return "";
};

const toolStatus = (
  status: "pending" | "in_progress" | "completed" | "failed" | null | undefined,
): "pending" | "running" | "completed" | "failed" => {
  if (status === "in_progress") {
    return "running";
  }
  return status ?? "pending";
};

export const normalizeSessionUpdate = (
  update: SessionUpdate,
): ReadonlyArray<NormalizedAgentEvent> => {
  if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
    return [{ type: "agent-message-chunk", chunk: update.content.text }];
  }
  if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
    return [{ type: "thought-chunk", chunk: update.content.text }];
  }
  if (update.sessionUpdate === "tool_call") {
    return [
      {
        type: "tool-call",
        toolCallId: ToolCallId.make(update.toolCallId),
        title: update.title,
        kind: update.kind ?? "other",
        status: toolStatus(update.status),
        content: (update.content ?? []).map(contentText).filter(Boolean).join("\n"),
      },
    ];
  }
  if (update.sessionUpdate === "tool_call_update") {
    return [
      {
        type: "tool-call",
        toolCallId: ToolCallId.make(update.toolCallId),
        title: update.title ?? "Tool activity",
        kind: update.kind ?? "other",
        status: toolStatus(update.status),
        content: (update.content ?? []).map(contentText).filter(Boolean).join("\n"),
      },
    ];
  }
  if (update.sessionUpdate === "plan") {
    return [
      {
        type: "plan",
        content: update.entries.map((entry) => `${entry.status}: ${entry.content}`).join("\n"),
      },
    ];
  }
  if (update.sessionUpdate === "usage_update") {
    return [
      {
        type: "usage",
        inputTokens: update.used,
        outputTokens: 0,
      },
    ];
  }
  return [];
};

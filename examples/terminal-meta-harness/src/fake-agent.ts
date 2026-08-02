#!/usr/bin/env node
import { Readable, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

const sessions = new Set<string>();
const agent = acp
  .agent({ name: "blog-post-fake-agent" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: {
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    },
    agentInfo: { name: "blog-post-fake-agent", version: "0.1.0" },
  }))
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = `demo-${crypto.randomUUID()}`;
    sessions.add(sessionId);
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
    if (!sessions.has(params.sessionId)) throw new Error("Unknown session");
    const text = params.prompt
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(" ");

    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `I received: ${text}` },
      },
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "demo-tool",
        title: "Create the requested change",
        kind: "edit",
        status: "pending",
      },
    });
    const permission = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: "demo-tool",
        title: "Create the requested change",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });
    return {
      stopReason:
        permission.outcome.outcome === "selected" && permission.outcome.optionId === "allow"
          ? "end_turn"
          : "cancelled",
    };
  });

agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  ),
);

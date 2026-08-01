#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";

const sessions = new Set<string>();
const cancellations = new Map<string, () => void>();
const noop = (): void => undefined;
const createCancellation = (): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} => {
  let resolve = noop;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

const app = acp
  .agent({ name: "MetaClanker deterministic fake" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: {
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
      sessionCapabilities: { close: {}, resume: {} },
    },
    agentInfo: { name: "metaclanker-fake-acp", version: "1.0.0" },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const sessionId = `fake-${crypto.randomUUID()}`;
    sessions.add(sessionId);
    return {
      sessionId,
      modes: {
        currentModeId: "default",
        availableModes: [{ id: "default", name: "Default", description: "Deterministic mode" }],
      },
      _meta: { cwd: params.cwd },
    };
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    sessions.add(params.sessionId);
    return {
      modes: {
        currentModeId: "default",
        availableModes: [{ id: "default", name: "Default", description: "Deterministic mode" }],
      },
      _meta: { cwd: params.cwd },
    };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
    if (!sessions.has(params.sessionId)) {
      throw new Error("Unknown fake session");
    }
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "I’ll inspect the project and make the requested change." },
      },
    });
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fake-tool-1",
        title: "Inspect project files",
        kind: "read",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "Project inspected" } }],
      },
    });
    const cancellation = createCancellation();
    cancellations.set(params.sessionId, cancellation.resolve);
    const permission = client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: "fake-tool-2",
        title: "Write implementation file",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });
    const outcome = await Promise.race([
      permission.then((value) => ({ type: "permission", value }) as const),
      cancellation.promise.then(() => ({ type: "cancelled" }) as const),
    ]);
    cancellations.delete(params.sessionId);
    if (
      outcome.type === "cancelled" ||
      outcome.value.outcome.outcome === "cancelled" ||
      outcome.value.outcome.optionId === "reject"
    ) {
      return { stopReason: "cancelled" };
    }
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: " Permission granted. The deterministic task is complete." },
      },
    });
    return { stopReason: "end_turn" };
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    cancellations.get(params.sessionId)?.();
  })
  .onRequest(acp.methods.agent.session.close, ({ params }) => {
    sessions.delete(params.sessionId);
    return {};
  });

app.connect(acp.ndJsonStream(WritableStreamFromStdout(), ReadableStreamFromStdin()));

function WritableStreamFromStdout(): WritableStream<Uint8Array> {
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    },
  });
}

function ReadableStreamFromStdin(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      process.stdin.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      process.stdin.on("end", () => controller.close());
      process.stdin.on("error", (error) => controller.error(error));
    },
  });
}

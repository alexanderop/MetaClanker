#!/usr/bin/env node
import * as acp from "@agentclientprotocol/sdk";

import { scenarioFromEnvironment } from "./scenarios.js";

const sessions = new Set<string>();
const scenario = scenarioFromEnvironment(process.env["METACLANKER_FAKE_ACP_SCENARIO"]);
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

const terminate = (): Promise<never> => {
  process.exitCode = 17;
  queueMicrotask(() => process.exit(17));
  return new Promise<never>(() => undefined);
};

const sessionModes = () => ({
  currentModeId: "default",
  availableModes: [{ id: "default", name: "Default", description: "Deterministic mode" }],
});

const app = acp
  .agent({ name: "MetaClanker deterministic fake" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => {
    if (scenario.crashAt === "initialize") return terminate();
    return {
      protocolVersion:
        scenario.protocolVersion === 1 ? params.protocolVersion : scenario.protocolVersion,
      agentCapabilities: {
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: {
          ...(scenario.sessionCapabilities.close ? { close: {} } : {}),
          ...(scenario.sessionCapabilities.resume ? { resume: {} } : {}),
          ...(scenario.sessionCapabilities.delete ? { delete: {} } : {}),
        },
        ...(scenario.sessionCapabilities.load ? { loadSession: true } : {}),
      },
      agentInfo: { name: "metaclanker-fake-acp", version: "1.0.0" },
    };
  })
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (scenario.crashAt === "session-new") return terminate();
    const sessionId = `fake-${crypto.randomUUID()}`;
    sessions.add(sessionId);
    return {
      sessionId,
      modes: sessionModes(),
      _meta: { cwd: params.cwd },
    };
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    sessions.add(params.sessionId);
    return {
      modes: sessionModes(),
      _meta: { cwd: params.cwd },
    };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ client, params }) => {
    if (!sessions.has(params.sessionId)) {
      throw new Error("Unknown fake session");
    }
    if (scenario.crashAt === "prompt" || scenario.prompt.mode === "crash") return terminate();
    if (scenario.prompt.mode === "malformed-frame") {
      process.stdout.write('{"jsonrpc":\n');
      return terminate();
    }
    if (scenario.prompt.mode === "complete") {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${scenario.prompt.message} (${params.sessionId})` },
        },
      });
      return { stopReason: "end_turn" };
    }

    const promptText = params.prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ");

    if (promptText.includes("trailing update")) {
      // Deliberately writes the final update after the prompt response so a
      // client that unbinds its turn on the response is caught dropping it.
      setTimeout(() => {
        void client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "trailing chunk" },
          },
        });
      }, 0);
      return { stopReason: "end_turn" };
    }

    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: scenario.prompt.message },
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

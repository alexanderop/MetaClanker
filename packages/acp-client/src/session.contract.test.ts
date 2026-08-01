import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { NormalizedAgentEvent } from "@metaclanker/application/ports";
import { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";

import { makeAcpSessions } from "./session.js";

const notObservedYet = (): void => undefined;

describe("ACP process supervision", () => {
  it("negotiates v1, streams updates, and resolves one live permission", async () => {
    const fakeAgent = fileURLToPath(
      new URL("../../testing/dist/acp/fake-agent.js", import.meta.url),
    );
    const sessions = makeAcpSessions({
      codex: { command: process.execPath, args: [fakeAgent] },
      claude: { command: process.execPath, args: [fakeAgent] },
    });
    const handle = await Effect.runPromise(
      sessions.open({
        provider: "codex",
        cwd: process.cwd(),
        projectId: ProjectId.make("project:test"),
        threadId: ThreadId.make("thread:test"),
        providerSessionId: null,
        model: null,
        effort: null,
        permissionMode: null,
      }),
    );
    const events: NormalizedAgentEvent[] = [];

    const result = await Effect.runPromise(
      handle.prompt(
        { turnId: TurnId.make("turn:test"), text: "Build it", attachments: [] },
        (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "permission") {
              yield* handle.respondInteraction(event.interaction.id, "allow").pipe(Effect.orDie);
            }
          }),
      ),
    );
    await Effect.runPromise(handle.close);

    expect(handle.capabilities.protocolVersion).toBe(1);
    expect(handle.capabilities.resume).toBe(true);
    expect(result.stopReason).toBe("completed");
    expect(events.map((event) => event.type)).toEqual([
      "agent-message-chunk",
      "tool-call",
      "permission",
      "agent-message-chunk",
    ]);

    const resumed = await Effect.runPromise(
      sessions.open({
        provider: "codex",
        cwd: process.cwd(),
        projectId: ProjectId.make("project:test"),
        threadId: ThreadId.make("thread:test"),
        providerSessionId: handle.providerSessionId,
        model: null,
        effort: null,
        permissionMode: null,
      }),
    );
    expect(resumed.providerSessionId).toBe(handle.providerSessionId);
    await Effect.runPromise(resumed.close);
  });

  it("keeps a session update that arrives after the prompt response", async () => {
    const fakeAgent = fileURLToPath(
      new URL("../../testing/dist/acp/fake-agent.js", import.meta.url),
    );
    const sessions = makeAcpSessions({
      codex: { command: process.execPath, args: [fakeAgent] },
      claude: { command: process.execPath, args: [fakeAgent] },
    });
    const handle = await Effect.runPromise(
      sessions.open({
        provider: "codex",
        cwd: process.cwd(),
        projectId: ProjectId.make("project:trailing"),
        threadId: ThreadId.make("thread:trailing"),
        providerSessionId: null,
        model: null,
        effort: null,
        permissionMode: null,
      }),
    );
    const chunks: string[] = [];
    let observeTrailing = notObservedYet;
    const trailing = new Promise<void>((resolve) => {
      observeTrailing = resolve;
    });

    const result = await Effect.runPromise(
      handle.prompt(
        {
          turnId: TurnId.make("turn:trailing"),
          text: "send a trailing update",
          attachments: [],
        },
        (event) =>
          Effect.sync(() => {
            if (event.type !== "agent-message-chunk") return;
            chunks.push(event.chunk);
            if (event.chunk.includes("trailing chunk")) observeTrailing();
          }),
      ),
    );
    expect(result.stopReason).toBe("completed");

    await trailing;
    await Effect.runPromise(handle.close);
    expect(chunks.join("")).toBe("trailing chunk");
  });
});

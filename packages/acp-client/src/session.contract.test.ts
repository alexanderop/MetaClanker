import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { NormalizedAgentEvent } from "@metaclanker/application/ports";
import { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";
import { fakeAcpEnvironment } from "@metaclanker/testing/acp/controller";
import { acpScenario, type AcpScenario } from "@metaclanker/testing/acp/scenarios";

import { makeAcpSessions } from "./session.js";

const notObservedYet = (): void => undefined;

const fakeAgent = fileURLToPath(new URL("../../testing/dist/acp/fake-agent.js", import.meta.url));

const openFakeSession = async (scenario: AcpScenario, suffix: string) => {
  const command = {
    command: process.execPath,
    args: [fakeAgent],
    environment: fakeAcpEnvironment(scenario),
  };
  const sessions = makeAcpSessions({ codex: command, claude: command });
  return Effect.runPromise(
    sessions.open({
      provider: "codex",
      cwd: process.cwd(),
      projectId: ProjectId.make(`project:${suffix}`),
      threadId: ThreadId.make(`thread:${suffix}`),
      providerSessionId: null,
      model: null,
      effort: null,
      permissionMode: null,
    }),
  );
};

describe("ACP process supervision", () => {
  it("negotiates v1, streams updates, and resolves one live permission", async () => {
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
        async (event) => {
          events.push(event);
          if (event.type === "permission") {
            await Effect.runPromise(handle.respondInteraction(event.interaction.id, "allow"));
          }
        },
      ),
    );
    await Effect.runPromise(handle.close);

    expect(handle.capabilities.protocolVersion).toBe(1);
    expect(handle.capabilities.resume).toBe(true);
    expect(handle.capabilities.models).toEqual(["fake-fast", "fake-deep"]);
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
        (event) => {
          if (event.type === "agent-message-chunk") {
            chunks.push(event.chunk);
            if (event.chunk.includes("trailing chunk")) observeTrailing();
          }
          return Promise.resolve();
        },
      ),
    );
    expect(result.stopReason).toBe("completed");

    await trailing;
    await Effect.runPromise(handle.close);
    expect(chunks.join("")).toBe("trailing chunk");
  });

  it("honors omitted session capabilities without inventing support", async () => {
    const handle = await openFakeSession(
      acpScenario({
        sessionCapabilities: { close: false, resume: false, load: false, delete: false },
        prompt: { mode: "complete" },
      }),
      "no-capabilities",
    );

    expect(handle.capabilities).toMatchObject({
      protocolVersion: 1,
      close: false,
      resume: false,
      load: false,
      delete: false,
    });
    await Effect.runPromise(handle.close);
  });

  it.each([
    ["read-only", "plan"],
    ["workspace-write", "acceptEdits"],
    ["full-access", "bypassPermissions"],
  ] as const)(
    "maps the generic %s permission choice to Claude's %s session mode",
    async (permissionMode, claudeMode) => {
      const scenario = acpScenario({
        modes: ["default", claudeMode],
        requiredMode: claudeMode,
        prompt: { mode: "complete" },
      });
      const command = {
        command: process.execPath,
        args: [fakeAgent],
        environment: fakeAcpEnvironment(scenario),
      };
      const handle = await Effect.runPromise(
        makeAcpSessions({ codex: command, claude: command }).open({
          provider: "claude",
          cwd: process.cwd(),
          projectId: ProjectId.make(`project:claude-${permissionMode}`),
          threadId: ThreadId.make(`thread:claude-${permissionMode}`),
          providerSessionId: null,
          model: null,
          effort: null,
          permissionMode,
        }),
      );

      try {
        expect(handle.capabilities.modes).toContain(claudeMode);
        await expect(
          Effect.runPromise(
            handle.prompt(
              {
                turnId: TurnId.make(`turn:claude-${permissionMode}`),
                text: "Complete the permission-mode regression probe",
                attachments: [],
              },
              () => Promise.resolve(),
            ),
          ),
        ).resolves.toEqual({ stopReason: "completed" });
      } finally {
        await Effect.runPromise(handle.close);
      }
    },
  );

  it("rejects an adapter that negotiates an unsupported protocol version", async () => {
    await expect(
      openFakeSession(acpScenario({ protocolVersion: 2 }), "unsupported-protocol"),
    ).rejects.toThrow("unsupported ACP protocol 2");
  });

  it("keeps concurrent provider processes isolated", async () => {
    const scenario = acpScenario({ prompt: { mode: "complete", message: "isolated" } });
    const [first, second] = await Promise.all([
      openFakeSession(scenario, "concurrent-first"),
      openFakeSession(scenario, "concurrent-second"),
    ]);
    const events = await Promise.all(
      [first, second].map((handle, index) => {
        const chunks: string[] = [];
        return Effect.runPromise(
          handle.prompt(
            {
              turnId: TurnId.make(`turn:concurrent-${String(index)}`),
              text: "Identify this session",
              attachments: [],
            },
            (event) => {
              if (event.type === "agent-message-chunk") chunks.push(event.chunk);
              return Promise.resolve();
            },
          ),
        ).then(() => chunks);
      }),
    );
    await Promise.all([Effect.runPromise(first.close), Effect.runPromise(second.close)]);

    expect(events[0]).toHaveLength(1);
    expect(events[1]).toHaveLength(1);
    expect(events[0]?.[0]).toMatch(/^isolated \(fake-/u);
    expect(events[1]?.[0]).toMatch(/^isolated \(fake-/u);
    expect(events[0]?.[0]).not.toBe(events[1]?.[0]);
  });

  it("reports a provider exit during prompt dispatch as a disconnected session", async () => {
    const handle = await openFakeSession(acpScenario({ crashAt: "prompt" }), "prompt-crash");

    await expect(
      Effect.runPromise(
        handle.prompt(
          { turnId: TurnId.make("turn:prompt-crash"), text: "Crash now", attachments: [] },
          () => Promise.resolve(),
        ),
      ),
    ).rejects.toThrow("ACP connection closed");
    await Effect.runPromise(handle.close);
  });
});

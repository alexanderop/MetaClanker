import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { expect, test } from "vitest";

import { Store } from "@metaclanker/application/commands";
import { CommandId, ProjectId } from "@metaclanker/contracts/ids";

test("first send rejects before persistence and preserves an accepted provider failure exactly once", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "metaclanker-orchestrator-data-"));
  const projectDirectory = await mkdtemp(join(tmpdir(), "metaclanker-orchestrator-project-"));
  const previousDataDirectory = process.env["METACLANKER_DATA_DIR"];
  const previousFakeEntry = process.env["METACLANKER_FAKE_ACP_ENTRY"];
  process.env["METACLANKER_DATA_DIR"] = dataDirectory;
  process.env["METACLANKER_FAKE_ACP_ENTRY"] = join(dataDirectory, "missing-fake-agent.mjs");

  const runtime = await import("./runtime.js");
  const orchestrator = await import("./orchestrator.js");
  const rejectedCommandId = CommandId.make("command:orchestrator-rejected");
  const acceptedCommandId = CommandId.make("command:orchestrator-accepted");
  const projectId = ProjectId.make("project:orchestrator");

  try {
    await expect(
      orchestrator.startThreadWithPrompt({
        commandId: rejectedCommandId,
        projectId: ProjectId.make("project:missing"),
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Do not persist this",
        attachments: [],
      }),
    ).rejects.toThrow("Project not found");
    const shellAfterRejection = await runtime.runApplication(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.shellSnapshot;
      }),
    );
    expect(shellAfterRejection.threads).toHaveLength(0);
    expect(shellAfterRejection.latestSequence).toBe(0);

    await runtime.runApplication(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:orchestrator-project"),
          name: "Orchestrator project",
          path: projectDirectory,
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
      }),
    );
    const input = {
      commandId: acceptedCommandId,
      projectId,
      provider: "codex" as const,
      model: null,
      effort: null,
      permissionMode: null,
      prompt: "Preserve this accepted turn",
      attachments: [],
    };
    const accepted = await orchestrator.startThreadWithPrompt(input);
    const replayed = await orchestrator.startThreadWithPrompt(input);
    expect(replayed).toEqual(accepted);

    await orchestrator.closeAgentSessions();
    const durable = await runtime.runApplication(
      Effect.gen(function* () {
        const store = yield* Store;
        const shell = yield* store.shellSnapshot;
        const detail = yield* store.getThread(accepted.thread.id);
        return { shell, detail };
      }),
    );
    expect(durable.shell.threads).toHaveLength(1);
    expect(durable.detail?.thread.status).toBe("failed");
    expect(durable.detail?.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(durable.detail?.messages.some((message) => message.role === "system")).toBe(true);
  } finally {
    await orchestrator.closeAgentSessions();
    await runtime.closeApplicationRuntime();
    if (previousDataDirectory === undefined) delete process.env["METACLANKER_DATA_DIR"];
    else process.env["METACLANKER_DATA_DIR"] = previousDataDirectory;
    if (previousFakeEntry === undefined) delete process.env["METACLANKER_FAKE_ACP_ENTRY"];
    else process.env["METACLANKER_FAKE_ACP_ENTRY"] = previousFakeEntry;
    await Promise.all([
      rm(dataDirectory, { recursive: true, force: true }),
      rm(projectDirectory, { recursive: true, force: true }),
    ]);
  }
});

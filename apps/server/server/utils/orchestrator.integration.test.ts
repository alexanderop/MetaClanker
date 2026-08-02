import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";
import { expect, test } from "vitest";

import { Store } from "@metaclanker/application/commands";
import { CommandId, ProjectId } from "@metaclanker/contracts/ids";
import { CheckpointsService } from "@metaclanker/git/checkpoints";

import { withOrchestrationHarness } from "../test-support/orchestration.js";
import { dispatchPrompt, restoreThreadFiles } from "./orchestrator.js";
import { runApplication } from "./runtime.js";

test("first send rejects before persistence and preserves an accepted provider failure exactly once", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const rejectedCommandId = CommandId.make("command:orchestrator-rejected");
      const acceptedCommandId = CommandId.make("command:orchestrator-accepted");
      const projectId = ProjectId.make("project:orchestrator");

      await expect(
        harness.startThreadWithPrompt({
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
      const shellAfterRejection = await harness.shellSnapshot();
      expect(shellAfterRejection.threads).toHaveLength(0);
      expect(shellAfterRejection.latestSequence).toBe(0);

      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:orchestrator-project"),
        name: "Orchestrator project",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-01T00:00:00.000Z",
      });
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
      const accepted = await harness.startThreadWithPrompt(input);
      const replayed = await harness.startThreadWithPrompt(input);
      expect(replayed).toEqual(accepted);

      await harness.close();
      const durable = {
        shell: await harness.shellSnapshot(),
        detail: await harness.threadDetail(accepted.thread.id),
      };
      expect(durable.shell.threads).toHaveLength(1);
      expect(durable.detail?.thread.status).toBe("failed");
      expect(durable.detail?.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(durable.detail?.messages.some((message) => message.role === "system")).toBe(true);
    },
    { fakeAcpEntry: join(process.cwd(), "missing-fake-agent.mjs") },
  );
});

test("an accepted first send streams through the production ACP supervisor exactly once", async () => {
  await withOrchestrationHarness(async (harness) => {
    const projectId = ProjectId.make("project:orchestrator-success");
    await harness.createProject({
      id: projectId,
      commandId: CommandId.make("command:orchestrator-success-project"),
      name: "Orchestrator success project",
      path: harness.projectDirectory,
      gitBranch: null,
      gitStatus: "unavailable",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const input = {
      commandId: CommandId.make("command:orchestrator-success"),
      projectId,
      provider: "claude" as const,
      model: null,
      effort: null,
      permissionMode: null,
      prompt: "Complete the deterministic turn",
      attachments: [],
    };

    const accepted = await harness.startThreadWithPrompt(input);
    const replayed = await harness.startThreadWithPrompt(input);
    await harness.drain();
    const detail = await harness.threadDetail(accepted.thread.id);

    expect(replayed).toEqual(accepted);
    expect(detail?.thread.status).toBe("completed");
    expect(detail?.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(detail?.messages.map((message) => message.content).join(" ")).toContain(
      "Integration fake completed",
    );
  });
});

test("a prompt after an adapter disconnect opens a fresh resumable session", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const projectId = ProjectId.make("project:orchestrator-reconnect");
      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:orchestrator-reconnect-project"),
        name: "Orchestrator reconnect project",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      const accepted = await harness.startThreadWithPrompt({
        commandId: CommandId.make("command:orchestrator-disconnect"),
        projectId,
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Crash this deterministic turn",
        attachments: [],
      });
      await harness.drain();
      expect((await harness.threadDetail(accepted.thread.id))?.thread.status).toBe(
        "recovery-required",
      );

      process.env["METACLANKER_FAKE_ACP_SCENARIO"] = JSON.stringify({
        prompt: { mode: "complete", message: "Fresh session completed" },
      });
      await dispatchPrompt(
        CommandId.make("command:orchestrator-after-disconnect"),
        accepted.thread.id,
        "Continue through a fresh adapter",
        [],
      );
      await harness.drain();

      const recovered = await harness.threadDetail(accepted.thread.id);
      expect(recovered?.thread.status).toBe("completed");
      expect(recovered?.messages.map((message) => message.content).join(" ")).toContain(
        "Fresh session completed",
      );
    },
    { fakeAcpScenario: JSON.stringify({ prompt: { mode: "crash" } }) },
  );
});

test("a confirmed restore records one undo checkpoint and replays the same command without repeating it", async () => {
  await withOrchestrationHarness(async (harness) => {
    const projectId = ProjectId.make("project:restore");
    await harness.createProject({
      id: projectId,
      commandId: CommandId.make("command:restore-project"),
      name: "Restore project",
      path: harness.projectDirectory,
      gitBranch: null,
      gitStatus: "unavailable",
      createdAt: "2026-08-02T00:00:00.000Z",
    });
    const started = await harness.startThreadWithPrompt({
      commandId: CommandId.make("command:restore-thread"),
      projectId,
      provider: "codex",
      model: null,
      effort: null,
      permissionMode: null,
      prompt: "Create an idle thread for restore",
      attachments: [],
    });
    await harness.drain();

    const target = join(harness.projectDirectory, "restore-target.txt");
    await writeFile(target, "before restore");
    const checkpoint = await runApplication(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.capture(harness.projectDirectory);
      }),
    );
    await runApplication(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.saveCheckpoint({
          checkpoint,
          threadId: started.thread.id,
          turnId: null,
          kind: "pre-turn",
        });
      }),
    );
    await writeFile(target, "after restore");

    const commandId = CommandId.make("command:restore-files");
    const first = await restoreThreadFiles(commandId, started.thread.id, checkpoint.id);
    const replayed = await restoreThreadFiles(commandId, started.thread.id, checkpoint.id);

    expect(await readFile(target, "utf8")).toBe("before restore");
    expect(replayed.checkpoint.id).toBe(first.checkpoint.id);
    expect(replayed.kind).toBe("undo");
  });
});

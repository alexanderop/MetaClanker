import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { expect, test } from "vitest";

import { Store } from "@metaclanker/application/commands";
import { CommandId, ProjectId } from "@metaclanker/contracts/ids";
import { CheckpointsService } from "@metaclanker/git/checkpoints";

import { withOrchestrationHarness } from "../test-support/orchestration.js";
import { subscribeToShell } from "./hub.js";
import {
  cancelPrompt,
  dispatchPrompt,
  respondToInteraction,
  restoreThreadFiles,
} from "./orchestrator.js";
import { runApplication } from "./runtime.js";

const waitForShellStatus = async (
  status: "needs-input" | "running" | "completed",
): Promise<{
  readonly wait: Promise<void>;
  readonly unsubscribe: () => void;
}> => {
  let resolveStatus: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    resolveStatus = resolve;
  });
  const unsubscribe = await subscribeToShell((event) => {
    if (event.type === "thread-status" && event.status === status) resolveStatus?.();
  });
  return { wait, unsubscribe };
};

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

test("a Claude workspace-write first send caches its advertised model catalog", async () => {
  await withOrchestrationHarness(
    async (harness) => {
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
        permissionMode: "workspace-write" as const,
        prompt: "Complete the deterministic turn",
        attachments: [],
      };

      const accepted = await harness.startThreadWithPrompt(input);
      const replayed = await harness.startThreadWithPrompt(input);
      await harness.drain();
      const detail = await harness.threadDetail(accepted.thread.id);
      const providerModels = await runApplication(
        Effect.gen(function* () {
          const store = yield* Store;
          return yield* store.listProviderModels;
        }),
      );

      expect(replayed).toEqual(accepted);
      expect(detail?.thread.status).toBe("completed");
      expect(detail?.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(detail?.messages.map((message) => message.content).join(" ")).toContain(
        "Integration fake completed",
      );
      expect(providerModels).toEqual([
        { provider: "claude", model: "default" },
        { provider: "claude", model: "opus" },
        { provider: "claude", model: "sonnet" },
      ]);
    },
    {
      fakeAcpScenario: JSON.stringify({
        models: ["default", "sonnet", "opus"],
        modes: ["default", "acceptEdits"],
        prompt: { mode: "complete", message: "Integration fake completed" },
      }),
    },
  );
});

test("malformed provider metadata keeps chat available and durably reports a degraded graph", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const projectId = ProjectId.make("project:metadata-degraded");
      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:metadata-degraded-project"),
        name: "Metadata degradation",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      const started = await harness.startThreadWithPrompt({
        commandId: CommandId.make("command:metadata-degraded-start"),
        projectId,
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Keep the conversation available",
        attachments: [],
      });
      await harness.drain();

      const detail = await harness.threadDetail(started.thread.id);
      expect(detail?.thread.status).toBe("completed");
      expect(detail?.messages.map((message) => message.content).join(" ")).toContain(
        "agent graph is degraded",
      );
    },
    {
      fakeAcpScenario: JSON.stringify({
        prompt: { mode: "complete", message: "Chat still completed" },
        metadataMode: "invalid-codex",
      }),
    },
  );
});

test("a disconnected provider without a safe rollover rejects a follow-up before durable admission", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const projectId = ProjectId.make("project:non-resumable");
      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:non-resumable-project"),
        name: "Non-resumable provider",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      const started = await harness.startThreadWithPrompt({
        commandId: CommandId.make("command:non-resumable-start"),
        projectId,
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Complete one safely attributed turn",
        attachments: [],
      });
      await harness.drain();
      await harness.restartRuntime();

      await expect(
        dispatchPrompt(
          CommandId.make("command:non-resumable-follow-up"),
          started.thread.id,
          "Do not misattribute this follow-up",
          [],
        ),
      ).rejects.toThrow("cannot safely correlate a follow-up turn");
      const detail = await harness.threadDetail(started.thread.id);
      expect(detail?.messages.filter((message) => message.role === "user")).toHaveLength(1);
    },
    {
      fakeAcpScenario: JSON.stringify({
        sessionCapabilities: { close: false, resume: false, load: false },
        prompt: { mode: "complete", message: "Only attributed turn" },
      }),
    },
  );
});

test("resume without close is not treated as a safe generation rollover", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const projectId = ProjectId.make("project:resume-without-close");
      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:resume-without-close-project"),
        name: "Resume without close",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      const started = await harness.startThreadWithPrompt({
        commandId: CommandId.make("command:resume-without-close-start"),
        projectId,
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Complete without a close boundary",
        attachments: [],
      });
      await harness.drain();

      await expect(
        dispatchPrompt(
          CommandId.make("command:resume-without-close-follow-up"),
          started.thread.id,
          "Do not cross the unsafe boundary",
          [],
        ),
      ).rejects.toThrow("cannot safely correlate a follow-up turn");
      const detail = await harness.threadDetail(started.thread.id);
      expect(detail?.messages.filter((message) => message.role === "user")).toHaveLength(1);
    },
    {
      fakeAcpScenario: JSON.stringify({
        sessionCapabilities: { close: false, resume: true, load: false },
        prompt: { mode: "complete", message: "No deterministic close boundary" },
      }),
    },
  );
});

test("a permission request publishes needs-input before returning to running and completing", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const projectId = ProjectId.make("project:orchestrator-permission-status");
      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:orchestrator-permission-project"),
        name: "Orchestrator permission project",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      const needsInput = await waitForShellStatus("needs-input");
      const started = await harness.startThreadWithPrompt({
        commandId: CommandId.make("command:orchestrator-permission-start"),
        projectId,
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Request deterministic permission",
        attachments: [],
      });

      await needsInput.wait;
      needsInput.unsubscribe();
      const waiting = await harness.threadDetail(started.thread.id);
      const interaction = waiting?.interactions.find((candidate) => candidate.status === "pending");
      expect(waiting?.thread.status).toBe("needs-input");
      expect(interaction?.title).toBe("Write implementation file");

      const running = await waitForShellStatus("running");
      await respondToInteraction(
        CommandId.make("command:orchestrator-permission-allow"),
        interaction!.id,
        "allow",
      );
      await running.wait;
      running.unsubscribe();
      await harness.drain();

      const completed = await harness.threadDetail(started.thread.id);
      expect(completed?.thread.status).toBe("completed");
      expect(completed?.interactions[0]?.status).toBe("resolved");
      expect(completed?.messages.map((message) => message.content).join(" ")).toContain(
        "Permission granted",
      );
    },
    {
      fakeAcpScenario: JSON.stringify({
        prompt: { mode: "permission", message: "Permission status test" },
      }),
    },
  );
});

test("cancelling a permission-blocked turn clears its pending interaction", async () => {
  await withOrchestrationHarness(
    async (harness) => {
      const projectId = ProjectId.make("project:orchestrator-permission-cancel");
      await harness.createProject({
        id: projectId,
        commandId: CommandId.make("command:orchestrator-permission-cancel-project"),
        name: "Orchestrator permission cancellation project",
        path: harness.projectDirectory,
        gitBranch: null,
        gitStatus: "unavailable",
        createdAt: "2026-08-02T00:00:00.000Z",
      });
      const needsInput = await waitForShellStatus("needs-input");
      const started = await harness.startThreadWithPrompt({
        commandId: CommandId.make("command:orchestrator-permission-cancel-start"),
        projectId,
        provider: "codex",
        model: null,
        effort: null,
        permissionMode: null,
        prompt: "Cancel deterministic permission",
        attachments: [],
      });

      await needsInput.wait;
      needsInput.unsubscribe();
      await cancelPrompt(
        CommandId.make("command:orchestrator-permission-cancel"),
        started.thread.id,
      );
      await harness.drain();

      const cancelled = await harness.threadDetail(started.thread.id);
      expect(cancelled?.thread.status).toBe("cancelled");
      expect(cancelled?.interactions[0]?.status).toBe("cancelled");
    },
    {
      fakeAcpScenario: JSON.stringify({
        prompt: { mode: "permission", message: "Permission cancellation test" },
      }),
    },
  );
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

      harness.setFakeAcpScenario(
        JSON.stringify({
          prompt: { mode: "complete", message: "Fresh session completed" },
        }),
      );
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

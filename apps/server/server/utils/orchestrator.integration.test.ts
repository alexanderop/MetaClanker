import { join } from "node:path";

import { expect, test } from "vitest";

import { CommandId, ProjectId } from "@metaclanker/contracts/ids";

import { withOrchestrationHarness } from "../test-support/orchestration.js";

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

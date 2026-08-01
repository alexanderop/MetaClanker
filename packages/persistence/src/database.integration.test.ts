import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { Store } from "@metaclanker/application/commands";
import {
  AgentNodeId,
  CommandId,
  PendingInteractionId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@metaclanker/contracts/ids";

import { databaseLayer } from "./database.js";

const temporaryDirectories: string[] = [];

const temporaryDatabase = async () => {
  const directory = await mkdtemp(join(tmpdir(), "metaclanker-db-"));
  temporaryDirectories.push(directory);
  return join(directory, "test.sqlite");
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SQLite event store", () => {
  it("returns the original aggregate when an accepted command is retried", async () => {
    const filename = await temporaryDatabase();
    const runtime = ManagedRuntime.make(databaseLayer(filename));
    const projectCommand = CommandId.make("command:project");
    const projectInput = {
      id: ProjectId.make("project:first"),
      commandId: projectCommand,
      name: "Test project",
      path: "/tmp/test-project",
      gitBranch: "main",
      gitStatus: "clean" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const first = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.createProject(projectInput);
      }),
    );
    const retried = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.createProject({
          ...projectInput,
          id: ProjectId.make("project:second"),
        });
      }),
    );
    await runtime.dispose();

    expect(retried.id).toBe(first.id);
    expect(retried.id).toBe("project:first");
  });

  it("marks live interactions stale and an active thread recovery-required after restart", async () => {
    const filename = await temporaryDatabase();
    const projectId = ProjectId.make("project:recovery");
    const threadId = ThreadId.make("thread:recovery");
    const interactionId = PendingInteractionId.make("interaction:recovery");
    const firstRuntime = ManagedRuntime.make(databaseLayer(filename));
    await firstRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:project-recovery"),
          name: "Recovery project",
          path: "/tmp/recovery-project",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.createThread({
          id: threadId,
          commandId: CommandId.make("command:thread-recovery"),
          projectId,
          provider: "codex",
          title: "Recover me",
          model: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.setThreadStatus(threadId, "running");
        yield* store.upsertInteraction({
          id: interactionId,
          projectId,
          threadId,
          turnId: TurnId.make("turn:recovery"),
          nodeId: AgentNodeId.make("node:recovery"),
          kind: "permission",
          title: "Approve",
          description: "Approve the action",
          options: [{ optionId: "allow", label: "Allow", kind: "allow-once" }],
          status: "pending",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
      }),
    );
    await firstRuntime.dispose();

    const restarted = ManagedRuntime.make(databaseLayer(filename));
    const detail = await restarted.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.getThread(threadId);
      }),
    );
    await restarted.dispose();

    expect(detail?.thread.status).toBe("recovery-required");
    expect(detail?.interactions[0]?.status).toBe("stale");
  });
});

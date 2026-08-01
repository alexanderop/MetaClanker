import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { Store } from "@metaclanker/application/commands";
import {
  AgentNodeId,
  CommandId,
  MessageId,
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

  it("accepts a new thread and its first turn exactly once", async () => {
    const filename = await temporaryDatabase();
    const runtime = ManagedRuntime.make(databaseLayer(filename));
    const projectId = ProjectId.make("project:first-send");
    const commandId = CommandId.make("command:first-send");

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:first-send-project"),
          name: "First send",
          path: "/tmp/first-send",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        const input = {
          id: ThreadId.make("thread:first-send"),
          turnId: TurnId.make("turn:first-send"),
          userMessageId: MessageId.make("message:first-send"),
          commandId,
          projectId,
          provider: "codex" as const,
          title: "Inspect the workspace",
          model: null,
          prompt: "Inspect the workspace",
          attachments: [],
          createdAt: "2026-08-01T00:00:01.000Z",
        };
        const [first, replayed] = yield* Effect.all(
          [
            store.startThread(input),
            store.startThread({
              ...input,
              id: ThreadId.make("thread:duplicate"),
              turnId: TurnId.make("turn:duplicate"),
              userMessageId: MessageId.make("message:duplicate"),
            }),
          ],
          { concurrency: "unbounded" },
        );
        const shell = yield* store.shellSnapshot;
        const detail = yield* store.getThread(first.thread.id);
        return { first, replayed, shell, detail };
      }),
    );
    await runtime.dispose();

    expect(result.first.acceptedNow).toBe(true);
    expect(result.replayed.acceptedNow).toBe(false);
    expect(result.replayed.thread.id).toBe(result.first.thread.id);
    expect(result.replayed.turnId).toBe(result.first.turnId);
    expect(result.shell.threads).toHaveLength(1);
    expect(result.detail?.thread.status).toBe("running");
    expect(result.detail?.messages).toHaveLength(1);
    expect(result.detail?.messages[0]).toMatchObject({
      role: "user",
      content: "Inspect the workspace",
      turnId: "turn:first-send",
    });
  });

  it("opens an existing project when the same normalized path is registered again", async () => {
    const filename = await temporaryDatabase();
    const runtime = ManagedRuntime.make(databaseLayer(filename));
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const first = yield* store.createProject({
          id: ProjectId.make("project:path-first"),
          commandId: CommandId.make("command:path-first"),
          name: "Original name",
          path: "/tmp/same-normalized-project",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        const duplicate = yield* store.createProject({
          id: ProjectId.make("project:path-duplicate"),
          commandId: CommandId.make("command:path-duplicate"),
          name: "Duplicate name",
          path: "/tmp/same-normalized-project",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:01.000Z",
        });
        const replayed = yield* store.createProject({
          id: ProjectId.make("project:path-retry"),
          commandId: CommandId.make("command:path-duplicate"),
          name: "Retry name",
          path: "/tmp/same-normalized-project",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:02.000Z",
        });
        const shell = yield* store.shellSnapshot;
        return { first, duplicate, replayed, shell };
      }),
    );
    await runtime.dispose();

    expect(result.duplicate.id).toBe(result.first.id);
    expect(result.replayed.id).toBe(result.first.id);
    expect(result.duplicate.name).toBe("Original name");
    expect(result.shell.projects).toHaveLength(1);
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

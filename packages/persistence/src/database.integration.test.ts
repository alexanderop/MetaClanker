import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, ManagedRuntime } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
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
import { emptyEventProjection, projectDomainEvent } from "@metaclanker/domain/events";

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

    expect(retried.record.id).toBe(first.record.id);
    expect(retried.record.id).toBe("project:first");
    expect(first.eventSequence).not.toBeNull();
    expect(retried.eventSequence).toBeNull();
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
        const events = yield* store.readEvents(0, 100);
        return {
          first,
          replayed,
          shell,
          detail,
          replayedProjection: events.reduce(projectDomainEvent, emptyEventProjection()),
        };
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
    expect(result.replayedProjection.shell).toEqual(result.shell);
    expect(result.replayedProjection.threads[result.first.thread.id]).toEqual(result.detail);
  });

  it("accepts concurrent retries of a follow-up turn exactly once", async () => {
    const filename = await temporaryDatabase();
    const runtime = ManagedRuntime.make(databaseLayer(filename));
    const projectId = ProjectId.make("project:follow-up");
    const threadId = ThreadId.make("thread:follow-up");
    const commandId = CommandId.make("command:follow-up");
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:follow-up-project"),
          name: "Follow-up project",
          path: "/tmp/follow-up-project",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.createThread({
          id: threadId,
          commandId: CommandId.make("command:follow-up-thread"),
          projectId,
          provider: "codex",
          title: "Follow-up",
          model: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        const makeInput = (suffix: string) => ({
          commandId,
          threadId,
          turnId: TurnId.make(`turn:follow-up:${suffix}`),
          userMessageId: MessageId.make(`message:follow-up:${suffix}`),
          prompt: "Continue",
          attachments: [],
          rootNode: {
            id: AgentNodeId.make("node:follow-up"),
            threadId,
            parentId: null,
            name: "Follow-up",
            provider: "codex" as const,
            model: null,
            state: "running" as const,
            activity: "Starting turn",
            childCount: 0,
            pendingApproval: false,
            changedFileCount: 0,
          },
          createdAt: "2026-08-01T00:00:01.000Z",
        });
        const attempts = yield* Effect.all(
          [store.startTurn(makeInput("first")), store.startTurn(makeInput("retry"))],
          { concurrency: "unbounded" },
        );
        return { attempts, detail: yield* store.getThread(threadId) };
      }),
    );
    await runtime.dispose();

    expect(result.attempts.filter((attempt) => attempt.acceptedNow)).toHaveLength(1);
    expect(result.attempts[0]?.turnId).toBe(result.attempts[1]?.turnId);
    expect(result.detail?.messages).toHaveLength(1);
    expect(result.detail?.messages[0]?.content).toBe("Continue");
    expect(result.detail?.agentNodes).toHaveLength(1);
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

    expect(result.duplicate.record.id).toBe(result.first.record.id);
    expect(result.replayed.record.id).toBe(result.first.record.id);
    expect(result.duplicate.record.name).toBe("Original name");
    expect(result.duplicate.eventSequence).toBeNull();
    expect(result.replayed.eventSequence).toBeNull();
    expect(result.shell.projects).toHaveLength(1);
  });

  it("replays agent child counts and checkpoints from the canonical journal", async () => {
    const filename = await temporaryDatabase();
    const runtime = ManagedRuntime.make(databaseLayer(filename));
    const projectId = ProjectId.make("project:journal-completeness");
    const threadId = ThreadId.make("thread:journal-completeness");
    const rootNodeId = AgentNodeId.make("node:journal-root");

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:journal-project"),
          name: "Journal completeness",
          path: "/tmp/journal-completeness",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.createThread({
          id: threadId,
          commandId: CommandId.make("command:journal-thread"),
          projectId,
          provider: "codex",
          title: "Replay durable state",
          model: null,
          createdAt: "2026-08-01T00:00:01.000Z",
        });
        yield* store.upsertAgentNode({
          id: rootNodeId,
          threadId,
          parentId: null,
          name: "Root",
          provider: "codex",
          model: null,
          state: "running",
          activity: "Delegating",
          childCount: 0,
          pendingApproval: false,
          changedFileCount: 0,
        });
        yield* store.upsertAgentNode({
          id: AgentNodeId.make("node:journal-child"),
          threadId,
          parentId: rootNodeId,
          name: "Child",
          provider: "codex",
          model: null,
          state: "running",
          activity: "Auditing",
          childCount: 0,
          pendingApproval: false,
          changedFileCount: 0,
        });
        const checkpoint = yield* store.saveCheckpoint({
          checkpoint: {
            id: "checkpoint:journal",
            projectPath: "/tmp/journal-completeness",
            createdAt: "2026-08-01T00:00:02.000Z",
            files: [{ path: "README.md", size: 42, kind: "tracked" }],
            snapshotPath: "/tmp/checkpoint-journal",
          },
          threadId,
          turnId: null,
          kind: "post-turn",
        });
        const detail = yield* store.getThread(threadId);
        const checkpoints = yield* store.listCheckpoints(threadId);
        const events = yield* store.readEvents(0, 100);
        return {
          checkpoint,
          checkpoints,
          detail,
          replayed: events.reduce(projectDomainEvent, emptyEventProjection()),
        };
      }),
    );
    await runtime.dispose();

    expect(result.detail?.agentNodes.find((node) => node.id === rootNodeId)?.childCount).toBe(1);
    expect(
      result.replayed.threads[threadId]?.agentNodes.find((node) => node.id === rootNodeId)
        ?.childCount,
    ).toBe(1);
    expect(result.checkpoints).toEqual([result.checkpoint]);
    expect(result.replayed.checkpoints[threadId]).toEqual([result.checkpoint]);
  });

  it("re-baselines legacy event payloads without breaking replay", async () => {
    const filename = await temporaryDatabase();
    const projectId = ProjectId.make("project:legacy");
    const firstRuntime = ManagedRuntime.make(databaseLayer(filename));
    await firstRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:legacy-project"),
          name: "Legacy project",
          path: "/tmp/legacy-project",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
      }),
    );
    await firstRuntime.dispose();

    const sqlRuntime = ManagedRuntime.make(SqliteClient.layer({ filename }));
    await sqlRuntime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM schema_migrations WHERE version IN (6, 7)`;
        yield* sql`INSERT INTO events
          (schema_version, event_id, thread_id, type, payload_json, received_at)
          VALUES (1, 'legacy:event', NULL, 'message.upserted',
            ${JSON.stringify({ type: "message.upserted", id: "legacy:message", role: "user" })},
            '2026-08-01T00:00:01.000Z')`;
      }),
    );
    await sqlRuntime.dispose();

    const restarted = ManagedRuntime.make(databaseLayer(filename));
    const result = await restarted.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const events = yield* store.readEvents(0, 100);
        return {
          shell: yield* store.shellSnapshot,
          replayed: events.reduce(projectDomainEvent, emptyEventProjection()),
          events,
        };
      }),
    );
    await restarted.dispose();

    expect(result.events.some((event) => event.eventId === "legacy:event")).toBe(false);
    expect(result.replayed.shell).toEqual(result.shell);
    expect(result.shell.projects).toContainEqual(expect.objectContaining({ id: projectId }));
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
        yield* store.startTurn({
          commandId: CommandId.make("command:turn-recovery"),
          threadId,
          turnId: TurnId.make("turn:recovery"),
          userMessageId: MessageId.make("message:recovery"),
          prompt: "Recover this turn",
          attachments: [],
          rootNode: {
            id: AgentNodeId.make("node:recovery"),
            threadId,
            parentId: null,
            name: "Recover me",
            provider: "codex",
            model: null,
            state: "running",
            activity: "Starting turn",
            childCount: 0,
            pendingApproval: false,
            changedFileCount: 0,
          },
          createdAt: "2026-08-01T00:00:01.000Z",
        });
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
    const recovered = await restarted.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const detail = yield* store.getThread(threadId);
        const next = yield* store.startTurn({
          commandId: CommandId.make("command:turn-after-recovery"),
          threadId,
          turnId: TurnId.make("turn:after-recovery"),
          userMessageId: MessageId.make("message:after-recovery"),
          prompt: "Continue safely",
          attachments: [],
          rootNode: {
            id: AgentNodeId.make("node:after-recovery"),
            threadId,
            parentId: null,
            name: "Recover me",
            provider: "codex",
            model: null,
            state: "running",
            activity: "Starting turn",
            childCount: 0,
            pendingApproval: false,
            changedFileCount: 0,
          },
          createdAt: "2026-08-01T00:00:02.000Z",
        });
        const events = yield* store.readEvents(0, 100);
        return { detail, next, events };
      }),
    );
    await restarted.dispose();

    expect(recovered.detail?.thread.status).toBe("recovery-required");
    expect(recovered.detail?.interactions[0]?.status).toBe("stale");
    expect(recovered.next.acceptedNow).toBe(true);
    expect(recovered.events).toContainEqual(
      expect.objectContaining({
        type: "turn.completed",
        turnId: "turn:recovery",
        outcome: "recovery-required",
      }),
    );
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scheduler from "effect/Scheduler";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe } from "vitest";

import { Store } from "@metaclanker/application/commands";
import {
  AgentNodeId,
  CheckpointId,
  CommandId,
  MessageId,
  PendingInteractionId,
  ProjectId,
  Sequence,
  ThreadId,
  TurnId,
} from "@metaclanker/contracts/ids";
import { defaultUserSettings } from "@metaclanker/contracts/wire";
import { emptyEventProjection, projectDomainEvent } from "@metaclanker/domain/events";

import { databaseLayer } from "./database.js";

/** Tied to the test scope so a failing assertion cannot leak an open SQLite handle. */
const temporaryDatabaseFile = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "metaclanker-db-"))),
  (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
).pipe(Effect.map((directory) => join(directory, "test.sqlite")));

/**
 * Runs a read and a write concurrently on the single shared SQLite connection with a
 * scheduling budget small enough that the two fibers interleave between statements the
 * same way on every run, rather than depending on how much work fits in a default slice.
 */
const interleaved = <A, B, E, R>(read: Effect.Effect<A, E, R>, write: Effect.Effect<B, E, R>) =>
  Effect.gen(function* () {
    const readFiber = yield* Effect.forkChild(read);
    const writeFiber = yield* Effect.forkChild(write);
    return { read: yield* Fiber.join(readFiber), written: yield* Fiber.join(writeFiber) };
  }).pipe(Effect.provideService(Scheduler.MaxOpsBeforeYield, 32));

describe("SQLite event store", () => {
  it.live("replaces and retains the ACP-advertised model catalog by provider", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.replaceProviderModels(
          "codex",
          ["gpt-5.6-codex", "gpt-5.6-codex", " gpt-5.5-codex "],
          "2026-08-02T00:00:00.000Z",
        );
        yield* store.replaceProviderModels(
          "claude",
          ["claude-opus-4-6"],
          "2026-08-02T00:00:01.000Z",
        );
      }).pipe(Effect.provide(databaseLayer(filename)));

      const retained = yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.replaceProviderModels("codex", ["gpt-5.6-codex"], "2026-08-02T00:00:02.000Z");
        return yield* store.listProviderModels;
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(retained).toEqual([
        { provider: "claude", model: "claude-opus-4-6" },
        { provider: "codex", model: "gpt-5.6-codex" },
      ]);
    }),
  );

  it.live("returns the original aggregate when an accepted command is retried", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
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
      const first = yield* Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.createProject(projectInput);
      }).pipe(Effect.provide(databaseLayer(filename)));
      const retried = yield* Effect.gen(function* () {
        const store = yield* Store;
        return yield* store.createProject({
          ...projectInput,
          id: ProjectId.make("project:second"),
        });
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(retried.record.id).toBe(first.record.id);
      expect(retried.record.id).toBe("project:first");
      expect(first.eventSequence).not.toBeNull();
      expect(retried.eventSequence).toBeNull();
    }),
  );

  it.live("accepts a new thread and its first turn exactly once", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:first-send");
      const commandId = CommandId.make("command:first-send");

      const result = yield* Effect.gen(function* () {
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
      }).pipe(Effect.provide(databaseLayer(filename)));

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
    }),
  );

  it.live("fences prompt intent claims and transitions by the active lease", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const result = yield* Effect.gen(function* () {
        const store = yield* Store;
        const projectId = ProjectId.make("project:intent-lease");
        const turnId = TurnId.make("turn:intent-lease");
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:intent-project"),
          name: "Intent lease",
          path: "/tmp/intent-lease",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-02T00:00:00.000Z",
        });
        yield* store.startThread({
          id: ThreadId.make("thread:intent-lease"),
          turnId,
          userMessageId: MessageId.make("message:intent-lease"),
          commandId: CommandId.make("command:intent-prompt"),
          projectId,
          provider: "codex",
          title: "Lease prompt",
          model: null,
          prompt: "Lease prompt",
          attachments: [],
          createdAt: "2026-08-02T00:00:01.000Z",
        });
        const claimed = yield* store.claimPromptIntent(
          turnId,
          "lease:current",
          "2026-08-02T00:05:00.000Z",
        );
        const duplicateClaim = yield* store.claimPromptIntent(
          turnId,
          "lease:stale",
          "2026-08-02T00:05:00.000Z",
        );
        const staleTransition = yield* store.transitionPromptIntent(
          turnId,
          "lease:stale",
          "dispatching-provider",
          "2026-08-02T00:00:02.000Z",
        );
        const currentTransition = yield* store.transitionPromptIntent(
          turnId,
          "lease:current",
          "dispatching-provider",
          "2026-08-02T00:00:02.000Z",
        );
        return { claimed, duplicateClaim, staleTransition, currentTransition };
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(result.claimed).toMatchObject({
        intentId: "turn:intent-lease",
        leaseId: "lease:current",
        attempt: 1,
        phase: "leased",
      });
      expect(result.duplicateClaim).toBeNull();
      expect(result.staleTransition).toBe(false);
      expect(result.currentTransition).toBe(true);
    }),
  );

  it.live(
    "admits a cancellation once before the provider notification and settles it with the turn",
    () =>
      Effect.gen(function* () {
        const filename = yield* temporaryDatabaseFile;
        const result = yield* Effect.gen(function* () {
          const store = yield* Store;
          const projectId = ProjectId.make("project:cancel");
          const threadId = ThreadId.make("thread:cancel");
          const turnId = TurnId.make("turn:cancel");
          const commandId = CommandId.make("command:cancel");
          yield* store.createProject({
            id: projectId,
            commandId: CommandId.make("command:cancel-project"),
            name: "Cancel prompt",
            path: "/tmp/cancel-prompt",
            gitBranch: null,
            gitStatus: "unavailable",
            createdAt: "2026-08-02T00:00:00.000Z",
          });
          yield* store.startThread({
            id: threadId,
            turnId,
            userMessageId: MessageId.make("message:cancel"),
            commandId: CommandId.make("command:cancel-prompt"),
            projectId,
            provider: "codex",
            title: "Cancel prompt",
            model: null,
            prompt: "Cancel prompt",
            attachments: [],
            createdAt: "2026-08-02T00:00:01.000Z",
          });
          const admitted = yield* store.admitCancel({
            commandId,
            threadId,
            leaseId: "lease:cancel",
            createdAt: "2026-08-02T00:00:02.000Z",
          });
          const replayed = yield* store.admitCancel({
            commandId,
            threadId,
            leaseId: "lease:cancel-replay",
            createdAt: "2026-08-02T00:00:03.000Z",
          });
          const awaiting = yield* store.markCancelAwaiting(
            turnId,
            "lease:cancel",
            "2026-08-02T00:00:04.000Z",
          );
          yield* store.completeTurn(turnId, "cancelled", "2026-08-02T00:00:05.000Z");
          return { admitted, replayed, awaiting, detail: yield* store.getThread(threadId) };
        }).pipe(Effect.provide(databaseLayer(filename)));

        expect(result.admitted).toMatchObject({ acceptedNow: true, turnId: "turn:cancel" });
        expect(result.replayed).toEqual({
          acceptedNow: false,
          turnId: "turn:cancel",
          eventSequence: null,
        });
        expect(result.awaiting).toBe(true);
        expect(result.detail?.thread.status).toBe("cancelling");
      }),
  );

  it.live(
    "marks an admitted destructive restore recovery-required without replaying it after restart",
    () =>
      Effect.gen(function* () {
        const filename = yield* temporaryDatabaseFile;
        const projectId = ProjectId.make("project:restore-recovery");
        const threadId = ThreadId.make("thread:restore-recovery");
        const commandId = CommandId.make("command:restore-recovery");
        const admitted = yield* Effect.gen(function* () {
          const store = yield* Store;
          yield* store.createProject({
            id: projectId,
            commandId: CommandId.make("command:restore-recovery-project"),
            name: "Restore recovery",
            path: "/tmp/restore-recovery",
            gitBranch: null,
            gitStatus: "unavailable",
            createdAt: "2026-08-02T00:00:00.000Z",
          });
          yield* store.createThread({
            id: threadId,
            commandId: CommandId.make("command:restore-recovery-thread"),
            projectId,
            provider: "codex",
            title: "Restore recovery",
            model: null,
            createdAt: "2026-08-02T00:00:01.000Z",
          });
          return yield* store.admitRestore({
            commandId,
            threadId,
            checkpointId: CheckpointId.make("checkpoint:source"),
            undoCheckpointId: CheckpointId.make("checkpoint:undo"),
            leaseId: "lease:restore",
            createdAt: "2026-08-02T00:00:02.000Z",
          });
        }).pipe(Effect.provide(databaseLayer(filename)));

        const recovered = yield* Effect.gen(function* () {
          const store = yield* Store;
          return {
            detail: yield* store.getThread(threadId),
            replayed: yield* store.admitRestore({
              commandId,
              threadId,
              checkpointId: CheckpointId.make("checkpoint:source"),
              undoCheckpointId: CheckpointId.make("checkpoint:other"),
              leaseId: "lease:restore-replay",
              createdAt: "2026-08-02T00:00:03.000Z",
            }),
          };
        }).pipe(Effect.provide(databaseLayer(filename)));

        expect(admitted).toMatchObject({ acceptedNow: true, undoCheckpointId: "checkpoint:undo" });
        expect(recovered.detail?.thread.status).toBe("recovery-required");
        expect(recovered.replayed).toEqual({
          acceptedNow: false,
          undoCheckpointId: "checkpoint:undo",
        });
      }),
  );

  it.live("accepts concurrent retries of a follow-up turn exactly once", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:follow-up");
      const threadId = ThreadId.make("thread:follow-up");
      const commandId = CommandId.make("command:follow-up");
      const result = yield* Effect.gen(function* () {
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
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(result.attempts.filter((attempt) => attempt.acceptedNow)).toHaveLength(1);
      expect(result.attempts[0]?.turnId).toBe(result.attempts[1]?.turnId);
      expect(result.detail?.messages).toHaveLength(1);
      expect(result.detail?.messages[0]?.content).toBe("Continue");
      expect(result.detail?.agentNodes).toHaveLength(1);
    }),
  );

  it.live("opens an existing project when the same normalized path is registered again", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const result = yield* Effect.gen(function* () {
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
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(result.duplicate.record.id).toBe(result.first.record.id);
      expect(result.replayed.record.id).toBe(result.first.record.id);
      expect(result.duplicate.record.name).toBe("Original name");
      expect(result.duplicate.eventSequence).toBeNull();
      expect(result.replayed.eventSequence).toBeNull();
      expect(result.shell.projects).toHaveLength(1);
    }),
  );

  it.live("replays agent child counts and checkpoints from the canonical journal", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:journal-completeness");
      const threadId = ThreadId.make("thread:journal-completeness");
      const rootNodeId = AgentNodeId.make("node:journal-root");

      const result = yield* Effect.gen(function* () {
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
            id: CheckpointId.make("checkpoint:journal"),
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
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(result.detail?.agentNodes.find((node) => node.id === rootNodeId)?.childCount).toBe(1);
      expect(
        result.replayed.threads[threadId]?.agentNodes.find((node) => node.id === rootNodeId)
          ?.childCount,
      ).toBe(1);
      expect(result.checkpoints).toEqual([result.checkpoint]);
      expect(result.replayed.checkpoints[threadId]).toEqual([result.checkpoint]);
    }),
  );

  it.live("re-baselines legacy event payloads without breaking replay", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:legacy");
      yield* Effect.gen(function* () {
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
      }).pipe(Effect.provide(databaseLayer(filename)));

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM schema_migrations WHERE version IN (6, 7)`;
        yield* sql`INSERT INTO events
          (schema_version, event_id, thread_id, type, payload_json, received_at)
          VALUES (1, 'legacy:event', NULL, 'message.upserted',
            ${JSON.stringify({ type: "message.upserted", id: "legacy:message", role: "user" })},
            '2026-08-01T00:00:01.000Z')`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      const result = yield* Effect.gen(function* () {
        const store = yield* Store;
        const events = yield* store.readEvents(0, 100);
        return {
          shell: yield* store.shellSnapshot,
          replayed: events.reduce(projectDomainEvent, emptyEventProjection()),
          events,
        };
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(result.events.some((event) => event.eventId === "legacy:event")).toBe(false);
      expect(result.replayed.shell).toEqual(result.shell);
      expect(result.shell.projects).toContainEqual(expect.objectContaining({ id: projectId }));
    }),
  );

  it.live(
    "marks live interactions stale and an active thread recovery-required after restart",
    () =>
      Effect.gen(function* () {
        const filename = yield* temporaryDatabaseFile;
        const projectId = ProjectId.make("project:recovery");
        const threadId = ThreadId.make("thread:recovery");
        const interactionId = PendingInteractionId.make("interaction:recovery");
        yield* Effect.gen(function* () {
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
          const admitted = yield* store.admitInteractionResponse({
            commandId: CommandId.make("command:interaction-recovery"),
            interactionId,
            optionId: "allow",
            leaseId: "lease:interaction-recovery",
            createdAt: "2026-08-01T00:00:01.500Z",
          });
          expect(admitted).toMatchObject({
            acceptedNow: true,
            interaction: { status: "dispatching" },
          });
        }).pipe(Effect.provide(databaseLayer(filename)));

        const recovered = yield* Effect.gen(function* () {
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
        }).pipe(Effect.provide(databaseLayer(filename)));

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
      }),
  );

  it.live("reports malformed persisted settings JSON through StoreError", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.saveSettings({
          schemaVersion: 1,
          theme: "dark",
          graphDensity: "comfortable",
          statusColors: "default",
          hiddenPanels: [],
          shortcuts: { commandPalette: "Meta+K", agentMap: "Meta+M", review: "Meta+R" },
          providerDefaults: {
            codex: { model: null, effort: null, permissionMode: null },
            claude: { model: null, effort: null, permissionMode: null },
          },
        });
      }).pipe(Effect.provide(databaseLayer(filename)));

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE settings SET value_json = '{invalid-json' WHERE key = 'user'`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const store = yield* Store;
          return yield* store.getSettings;
        }).pipe(Effect.provide(databaseLayer(filename))),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      const error = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(error)).toBe(true);
      if (Option.isSome(error)) {
        expect(error.value).toMatchObject({ _tag: "StoreError", code: "persistence" });
      }
    }),
  );

  it.live("rejects corrupted SQLite boolean and natural-number projections", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:corrupt-row");
      yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:corrupt-row"),
          name: "Corrupt row",
          path: "/tmp/corrupt-row",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-02T00:00:00.000Z",
        });
      }).pipe(Effect.provide(databaseLayer(filename)));

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE projects SET hidden = 2, sort_order = -1 WHERE id = ${projectId}`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const store = yield* Store;
          return yield* store.shellSnapshot;
        }).pipe(Effect.provide(databaseLayer(filename))),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      const error = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(error)).toBe(true);
      if (Option.isSome(error)) {
        expect(error.value).toMatchObject({ _tag: "StoreError", code: "persistence" });
      }
    }),
  );

  it.live("reports a malformed persisted receipt aggregate through StoreError", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const commandId = CommandId.make("command:corrupt-receipt");
      yield* Effect.gen(function* () {
        yield* Store;
      }).pipe(Effect.provide(databaseLayer(filename)));

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO command_receipts
          (command_id, status, aggregate_id, reason, created_at)
          VALUES (${commandId}, 'accepted', '', NULL, '2026-08-02T00:00:00.000Z')`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const store = yield* Store;
          return yield* store.createProject({
            id: ProjectId.make("project:corrupt-receipt"),
            commandId,
            name: "Corrupt receipt",
            path: "/tmp/corrupt-receipt",
            gitBranch: null,
            gitStatus: "unavailable",
            createdAt: "2026-08-02T00:00:00.000Z",
          });
        }).pipe(Effect.provide(databaseLayer(filename))),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      const error = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(error)).toBe(true);
      if (Option.isSome(error)) {
        expect(error.value).toMatchObject({ _tag: "StoreError", code: "persistence" });
      }
    }),
  );

  it.live(
    "conservatively backfills continuation safety when upgrading a saved provider session",
    () =>
      Effect.gen(function* () {
        const filename = yield* temporaryDatabaseFile;
        const projectId = ProjectId.make("project:v8-provider-session");
        const threadId = ThreadId.make("thread:v8-provider-session");
        yield* Effect.gen(function* () {
          const store = yield* Store;
          yield* store.createProject({
            id: projectId,
            commandId: CommandId.make("command:v8-provider-session-project"),
            name: "Version eight provider session",
            path: "/tmp/v8-provider-session",
            gitBranch: null,
            gitStatus: "unavailable",
            createdAt: "2026-08-02T00:00:00.000Z",
          });
          yield* store.createThread({
            id: threadId,
            commandId: CommandId.make("command:v8-provider-session-thread"),
            projectId,
            provider: "codex",
            title: "Saved provider session",
            model: null,
            createdAt: "2026-08-02T00:00:01.000Z",
          });
          yield* store.setProviderSession(threadId, "provider-session:v8", "safe");
        }).pipe(Effect.provide(databaseLayer(filename)));

        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM schema_migrations WHERE version = 9`;
          yield* sql`DROP TABLE provider_session_capabilities`;
        }).pipe(Effect.provide(SqliteClient.layer({ filename })));

        const safety = yield* Effect.gen(function* () {
          const store = yield* Store;
          return yield* store.getProviderContinuationSafety(threadId);
        }).pipe(Effect.provide(databaseLayer(filename)));

        expect(safety).toBe("unsafe");
      }),
  );

  it.live("refuses to journal an event the read path could not decode", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:undecodable");
      const threadId = ThreadId.make("thread:undecodable");

      const observed = yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:undecodable-project"),
          name: "Undecodable",
          path: "/tmp/undecodable",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.startThread({
          id: threadId,
          turnId: TurnId.make("turn:undecodable"),
          userMessageId: MessageId.make("message:undecodable"),
          commandId: CommandId.make("command:undecodable-thread"),
          projectId,
          provider: "codex",
          title: "Undecodable",
          model: null,
          prompt: "Start",
          attachments: [],
          createdAt: "2026-08-01T00:00:01.000Z",
        });
        // The domain type says `number`; the schema says `Schema.Natural`. Writing raw
        // JSON accepted this and left a row nothing could ever read back.
        const rejected = yield* Effect.flip(
          store.upsertAgentNode({
            id: AgentNodeId.make("node:undecodable"),
            threadId,
            parentId: null,
            name: "Undecodable",
            provider: "codex",
            model: null,
            state: "running",
            activity: "Working",
            childCount: -1,
            pendingApproval: false,
            changedFileCount: 0,
          }),
        );
        return { rejected, events: yield* store.readEvents(Sequence.make(0), 100) };
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(observed.rejected.code).toBe("persistence");
      expect(observed.events.some((event) => event.type === "agent-node.upserted")).toBe(false);
    }),
  );

  it.live("reports where a stored row failed to decode without echoing it", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const secret = "/Users/alex/private/prompt.txt";

      yield* Effect.void.pipe(Effect.provide(databaseLayer(filename)), Effect.scoped);
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT OR REPLACE INTO settings (key, schema_version, value_json, updated_at)
          VALUES ('user', 1, ${JSON.stringify({ ...defaultUserSettings, theme: { leaked: secret } })},
          '2026-08-01')`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      const failure = yield* Effect.gen(function* () {
        const store = yield* Store;
        return yield* Effect.flip(store.getSettings);
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect(failure.message).toContain("theme");
      // A `SchemaError`'s own message embeds the value it rejected.
      expect(failure.message).not.toContain(secret);
    }),
  );

  it.live("keeps a deliberately raised store failure's code", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:error-codes");
      const threadId = ThreadId.make("thread:error-codes");

      const observed = yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:error-codes-project"),
          name: "Error codes",
          path: "/tmp/error-codes",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.startThread({
          id: threadId,
          turnId: TurnId.make("turn:error-codes"),
          userMessageId: MessageId.make("message:error-codes"),
          commandId: CommandId.make("command:error-codes-thread"),
          projectId,
          provider: "codex",
          title: "Error codes",
          model: null,
          prompt: "Start",
          attachments: [],
          createdAt: "2026-08-01T00:00:01.000Z",
        });
        const conflict = yield* Effect.flip(
          store.startTurn({
            commandId: CommandId.make("command:error-codes-second-turn"),
            threadId,
            turnId: TurnId.make("turn:error-codes-second"),
            userMessageId: MessageId.make("message:error-codes-second"),
            prompt: "Continue",
            attachments: [],
            rootNode: {
              id: AgentNodeId.make("node:error-codes"),
              threadId,
              parentId: null,
              name: "Error codes",
              provider: "codex",
              model: null,
              state: "running",
              activity: "Starting turn",
              childCount: 0,
              pendingApproval: false,
              changedFileCount: 0,
            },
            createdAt: "2026-08-01T00:00:02.000Z",
          }),
        );
        const missing = yield* Effect.flip(
          store.renameProject(ProjectId.make("project:absent"), "Renamed"),
        );
        return { conflict, missing };
      }).pipe(Effect.provide(databaseLayer(filename)));

      // A blanket `mapError` used to rewrite both to "persistence", which the HTTP edge
      // reports as an opaque 500 rather than a 409 or a 404.
      expect(observed.conflict.code).toBe("conflict");
      expect(observed.missing.code).toBe("not-found");
    }),
  );

  it.live("records no schema version when a migration step fails part way through", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;

      // Migration 4 creates this index, and SQLite refuses a name an existing table owns.
      // Versions 1 through 3 have already been written by then.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE turns_command_id (placeholder TEXT)`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      const failure = yield* Effect.flip(
        Effect.void.pipe(Effect.provide(databaseLayer(filename)), Effect.scoped),
      );

      const objects = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{
          readonly name: string;
        }>`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`;
      }).pipe(Effect.provide(SqliteClient.layer({ filename })));

      expect(failure).toBeDefined();
      // A recorded version whose statements never ran is skipped forever on the next boot.
      expect(objects.map((row) => row.name)).toEqual(["turns_command_id"]);
    }),
  );

  it.live("never stamps a shell snapshot with a sequence it did not observe", () =>
    Effect.gen(function* () {
      const filename = yield* temporaryDatabaseFile;
      const projectId = ProjectId.make("project:snapshot-consistency");

      const observed = yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:snapshot-consistency"),
          name: "Original",
          path: "/tmp/snapshot-consistency",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });

        return yield* interleaved(store.shellSnapshot, store.renameProject(projectId, "Renamed"));
      }).pipe(Effect.provide(databaseLayer(filename)));

      const project = observed.read.projects.find((entry) => entry.id === projectId);
      // A client resyncs by replaying events strictly after `latestSequence`. A snapshot
      // holding the pre-rename row while claiming to cover the rename event therefore
      // diverges permanently.
      expect({
        name: project?.name,
        coversWrite: observed.read.latestSequence >= (observed.written.eventSequence ?? 0),
      }).toEqual({ name: "Original", coversWrite: false });
    }),
  );

  it.live("never stamps a thread detail with a sequence it did not observe", () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project:detail-consistency");
      const threadId = ThreadId.make("thread:detail-consistency");
      const filename = yield* temporaryDatabaseFile;

      const observed = yield* Effect.gen(function* () {
        const store = yield* Store;
        yield* store.createProject({
          id: projectId,
          commandId: CommandId.make("command:detail-consistency-project"),
          name: "Detail consistency",
          path: "/tmp/detail-consistency",
          gitBranch: null,
          gitStatus: "unavailable",
          createdAt: "2026-08-01T00:00:00.000Z",
        });
        yield* store.startThread({
          id: threadId,
          turnId: TurnId.make("turn:detail-consistency"),
          userMessageId: MessageId.make("message:detail-consistency"),
          commandId: CommandId.make("command:detail-consistency-thread"),
          projectId,
          provider: "codex",
          title: "Original",
          model: null,
          prompt: "Inspect the workspace",
          attachments: [],
          createdAt: "2026-08-01T00:00:01.000Z",
        });

        return yield* interleaved(
          store.getThread(threadId),
          store.renameThread(threadId, "Renamed"),
        );
      }).pipe(Effect.provide(databaseLayer(filename)));

      expect({
        title: observed.read?.thread.title,
        coversWrite: (observed.read?.latestSequence ?? 0) >= observed.written.eventSequence,
      }).toEqual({ title: "Original", coversWrite: false });
    }),
  );
});

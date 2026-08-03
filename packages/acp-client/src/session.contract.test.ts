import { fileURLToPath } from "node:url";

import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe } from "vitest";

import type { AcpSessionHandle, NormalizedAgentEvent } from "@metaclanker/application/ports";
import { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";
import { fakeAcpEnvironment } from "@metaclanker/testing/acp/controller";
import { acpScenario, type AcpScenario } from "@metaclanker/testing/acp/scenarios";

import { makeAcpSessions } from "./session.js";

const fakeAgent = fileURLToPath(new URL("../../testing/dist/acp/fake-agent.js", import.meta.url));

const fakeSessions = (scenario: AcpScenario = acpScenario()) => {
  const command = {
    command: process.execPath,
    args: [fakeAgent],
    environment: fakeAcpEnvironment(scenario),
  };
  return makeAcpSessions({ codex: command, claude: command });
};

const openFakeSession = (scenario: AcpScenario, suffix: string, provider = "codex" as const) =>
  fakeSessions(scenario).open({
    provider,
    cwd: process.cwd(),
    projectId: ProjectId.make(`project:${suffix}`),
    threadId: ThreadId.make(`thread:${suffix}`),
    providerSessionId: null,
    model: null,
    effort: null,
    permissionMode: null,
  });

const collectUntilClose = <E>(
  handle: AcpSessionHandle,
  consume: (event: NormalizedAgentEvent) => Effect.Effect<void, E>,
) => {
  const events: NormalizedAgentEvent[] = [];
  return {
    events,
    start: handle.events.pipe(
      Stream.runForEach((event) =>
        Effect.sync(() => events.push(event)).pipe(Effect.andThen(consume(event))),
      ),
      Effect.forkScoped,
    ),
  };
};

const collectEventsUntilClose = (handle: AcpSessionHandle) =>
  collectUntilClose(handle, () => Effect.void);

describe("ACP process supervision", () => {
  for (const crashAt of ["initialize", "session-new"] as const) {
    it.effect(`terminates the adapter when ${crashAt} acquisition fails`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          let childPid: number | undefined;
          const scenario = acpScenario({ crashAt });
          const command = {
            command: process.execPath,
            args: [fakeAgent],
            environment: fakeAcpEnvironment(scenario),
            onSpawn: (pid: number) => {
              childPid = pid;
            },
          };
          const sessions = makeAcpSessions({ codex: command, claude: command });
          yield* sessions
            .open({
              provider: "codex",
              cwd: process.cwd(),
              projectId: ProjectId.make(`project:${crashAt}`),
              threadId: ThreadId.make(`thread:${crashAt}`),
              providerSessionId: null,
              model: null,
              effort: null,
              permissionMode: null,
            })
            .pipe(Effect.flip);
          expect(childPid).toBeTypeOf("number");
          let running = false;
          if (childPid !== undefined) {
            try {
              process.kill(childPid, 0);
              running = true;
            } catch {
              running = false;
            }
          }
          expect(running).toBe(false);
        }),
      ),
    );
  }

  it.effect("interrupts a stalled initialization and terminates its adapter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawned = yield* Deferred.make<number>();
        const command = {
          command: process.execPath,
          args: [fakeAgent],
          environment: fakeAcpEnvironment(acpScenario({ crashAt: "initialize-hang" })),
          onSpawn: (pid: number) => {
            Effect.runFork(Deferred.succeed(spawned, pid));
          },
        };
        const sessions = makeAcpSessions({ codex: command, claude: command });
        const opening = yield* sessions
          .open({
            provider: "codex",
            cwd: process.cwd(),
            projectId: ProjectId.make("project:stalled-initialize"),
            threadId: ThreadId.make("thread:stalled-initialize"),
            providerSessionId: null,
            model: null,
            effort: null,
            permissionMode: null,
          })
          .pipe(Effect.forkScoped);
        const childPid = yield* Deferred.await(spawned);
        yield* Fiber.interrupt(opening);
        expect(() => process.kill(childPid, 0)).toThrow();
      }),
    ),
  );

  it.effect("negotiates v1, streams updates, and resolves one live permission", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sessions = fakeSessions();
        const handle = yield* sessions.open({
          provider: "codex",
          cwd: process.cwd(),
          projectId: ProjectId.make("project:test"),
          threadId: ThreadId.make("thread:test"),
          providerSessionId: null,
          model: null,
          effort: null,
          permissionMode: null,
        });
        const collected = collectUntilClose(handle, (event) =>
          event.type === "permission"
            ? handle.respondInteraction(event.interaction.id, "allow")
            : Effect.void,
        );
        const consumer = yield* collected.start;
        const result = yield* handle.prompt({
          turnId: TurnId.make("turn:test"),
          text: "Build it",
          attachments: [],
        });
        const providerSessionId = handle.providerSessionId;
        yield* handle.close;
        yield* Fiber.join(consumer);

        expect(handle.capabilities.protocolVersion).toBe(1);
        expect(handle.capabilities.resume).toBe(true);
        expect(handle.capabilities.models).toEqual(["fake-fast", "fake-deep"]);
        expect(result.stopReason).toBe("completed");
        expect(collected.events.map((event) => event.type)).toEqual([
          "agent-message-chunk",
          "tool-call",
          "permission",
          "agent-message-chunk",
        ]);

        const resumed = yield* sessions.open({
          provider: "codex",
          cwd: process.cwd(),
          projectId: ProjectId.make("project:test"),
          threadId: ThreadId.make("thread:test"),
          providerSessionId,
          model: null,
          effort: null,
          permissionMode: null,
        });
        expect(resumed.providerSessionId).toBe(providerSessionId);
        yield* resumed.close;
      }),
    ),
  );

  it.effect("keeps a session update that arrives after the prompt response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* openFakeSession(acpScenario(), "trailing");
        const chunks: string[] = [];
        const consumer = yield* handle.events.pipe(
          Stream.runForEach((event) =>
            event.type !== "agent-message-chunk"
              ? Effect.void
              : Effect.sync(() => chunks.push(event.chunk)),
          ),
          Effect.forkScoped,
        );
        const result = yield* handle.prompt({
          turnId: TurnId.make("turn:trailing"),
          text: "send a trailing update",
          attachments: [],
        });
        expect(result.stopReason).toBe("completed");
        yield* handle.close;
        yield* Fiber.join(consumer);
        expect(chunks.join("")).toBe("trailing chunk");
      }),
    ),
  );

  it.effect("honors omitted session capabilities without inventing support", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* openFakeSession(
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
        yield* handle.close;
      }),
    ),
  );

  it.effect(
    "keeps chat running but degrades graph capability for malformed provider metadata",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* openFakeSession(
            acpScenario({
              prompt: { mode: "complete", message: "metadata drift" },
              metadataMode: "invalid-codex",
            }),
            "metadata-drift",
          );
          const collected = collectEventsUntilClose(handle);
          const consumer = yield* collected.start;
          const result = yield* handle.prompt({
            turnId: TurnId.make("turn:metadata-drift"),
            text: "Keep chat available",
            attachments: [],
          });
          yield* handle.drainAcceptedEvents;
          expect(result).toEqual({ stopReason: "completed" });
          expect(handle.capabilities.graph).toBe("degraded");
          yield* handle.close;
          yield* Fiber.join(consumer);
          expect(collected.events).toContainEqual({
            type: "capability-degraded",
            capability: "graph",
          });
        }),
      ),
  );

  for (const [permissionMode, claudeMode] of [
    ["read-only", "plan"],
    ["workspace-write", "acceptEdits"],
    ["full-access", "bypassPermissions"],
  ] as const) {
    it.effect(
      `maps the generic ${permissionMode} permission choice to Claude's ${claudeMode} session mode`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
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
            const handle = yield* makeAcpSessions({ codex: command, claude: command }).open({
              provider: "claude",
              cwd: process.cwd(),
              projectId: ProjectId.make(`project:claude-${permissionMode}`),
              threadId: ThreadId.make(`thread:claude-${permissionMode}`),
              providerSessionId: null,
              model: null,
              effort: null,
              permissionMode,
            });
            const consumer = yield* collectEventsUntilClose(handle).start;
            expect(handle.capabilities.modes).toContain(claudeMode);
            expect(
              yield* handle.prompt({
                turnId: TurnId.make(`turn:claude-${permissionMode}`),
                text: "Complete the permission-mode regression probe",
                attachments: [],
              }),
            ).toEqual({ stopReason: "completed" });
            yield* handle.close;
            yield* Fiber.join(consumer);
          }),
        ),
    );
  }

  it.effect("rejects an adapter that negotiates an unsupported protocol version", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = yield* openFakeSession(
          acpScenario({ protocolVersion: 2 }),
          "unsupported-protocol",
        ).pipe(Effect.flip);
        expect(failure.message).toContain("unsupported ACP protocol 2");
      }),
    ),
  );

  it.effect("keeps concurrent provider processes isolated", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scenario = acpScenario({ prompt: { mode: "complete", message: "isolated" } });
        const [first, second] = yield* Effect.all(
          [
            openFakeSession(scenario, "concurrent-first"),
            openFakeSession(scenario, "concurrent-second"),
          ],
          { concurrency: 2 },
        );
        const firstCollected = collectEventsUntilClose(first);
        const secondCollected = collectEventsUntilClose(second);
        const [firstConsumer, secondConsumer] = yield* Effect.all([
          firstCollected.start,
          secondCollected.start,
        ]);
        yield* Effect.all(
          [
            first.prompt({
              turnId: TurnId.make("turn:concurrent-0"),
              text: "Identify this session",
              attachments: [],
            }),
            second.prompt({
              turnId: TurnId.make("turn:concurrent-1"),
              text: "Identify this session",
              attachments: [],
            }),
          ],
          { concurrency: 2 },
        );
        yield* Effect.all([first.close, second.close], { concurrency: 2 });
        yield* Effect.all([Fiber.join(firstConsumer), Fiber.join(secondConsumer)]);

        const firstChunks = firstCollected.events.flatMap((event) =>
          event.type === "agent-message-chunk" ? [event.chunk] : [],
        );
        const secondChunks = secondCollected.events.flatMap((event) =>
          event.type === "agent-message-chunk" ? [event.chunk] : [],
        );
        expect(firstChunks).toHaveLength(1);
        expect(secondChunks).toHaveLength(1);
        expect(firstChunks[0]).toMatch(/^isolated \(fake-/u);
        expect(secondChunks[0]).toMatch(/^isolated \(fake-/u);
        expect(firstChunks[0]).not.toBe(secondChunks[0]);
      }),
    ),
  );

  it.effect("reports a provider exit during prompt dispatch as a disconnected session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* openFakeSession(acpScenario({ crashAt: "prompt" }), "prompt-crash");
        const failure = yield* handle
          .prompt({
            turnId: TurnId.make("turn:prompt-crash"),
            text: "Crash now",
            attachments: [],
          })
          .pipe(Effect.flip);
        expect(failure.message).toContain("ACP connection closed");
      }),
    ),
  );

  it.effect("fails a saturated callback ingress instead of creating detached producer work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* openFakeSession(
          acpScenario({ prompt: { mode: "event-overflow" } }),
          "event-overflow",
        );
        yield* handle
          .prompt({
            turnId: TurnId.make("turn:event-overflow"),
            text: "Saturate event ingress",
            attachments: [],
          })
          .pipe(Effect.exit);
        const failure = yield* handle.drainAcceptedEvents.pipe(Effect.flip);
        expect(failure).toMatchObject({ _tag: "AcpRuntimeError", code: "event-overflow" });
      }),
    ),
  );
});

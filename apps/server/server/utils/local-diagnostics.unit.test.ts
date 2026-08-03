import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe } from "vitest";

import { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";

import { LocalDiagnostics, localDiagnosticsLayer } from "./local-diagnostics.js";

/** Tied to the test scope so a failing assertion cannot leak the directory. */
const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "metaclanker-diagnostics-"))),
  (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
);

describe("local diagnostics", () => {
  it.live("writes only structured correlation metadata when explicitly enabled", () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;

      // The layer's finalizer flushes, so the write is observable only after its scope
      // closes — which is exactly what ties the flush to the test scope.
      yield* Effect.gen(function* () {
        const diagnostics = yield* LocalDiagnostics;
        yield* diagnostics.record({
          operation: "agent.prompt",
          phase: "completed",
          outcome: "ok",
          durationMs: 42,
          provider: "codex",
          projectId: ProjectId.make("project:diagnostic"),
          threadId: ThreadId.make("thread:diagnostic"),
          turnId: TurnId.make("turn:diagnostic"),
        });
      }).pipe(Effect.provide(localDiagnosticsLayer(directory, true)), Effect.scoped);

      const output = yield* Effect.promise(() =>
        readFile(join(directory, "diagnostics", "trace.ndjson"), "utf8"),
      );
      const record: unknown = JSON.parse(output.trim());

      expect(record).toMatchObject({
        schemaVersion: 1,
        operation: "agent.prompt",
        phase: "completed",
        outcome: "ok",
        durationMs: 42,
        provider: "codex",
      });
      expect(output).not.toContain("prompt text");
      expect(output).not.toContain("/Users/");
    }),
  );
});

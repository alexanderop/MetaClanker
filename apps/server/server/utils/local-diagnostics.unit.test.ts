import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";

import { LocalDiagnostics, localDiagnosticsLayer } from "./local-diagnostics.js";

describe("local diagnostics", () => {
  it("writes only structured correlation metadata when explicitly enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metaclanker-diagnostics-"));
    const runtime = ManagedRuntime.make(localDiagnosticsLayer(directory, true));
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
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
        }),
      );
      await runtime.dispose();

      const output = await readFile(join(directory, "diagnostics", "trace.ndjson"), "utf8");
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
    } finally {
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

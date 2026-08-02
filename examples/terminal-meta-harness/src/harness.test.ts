import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TerminalHarness, type HarnessEvent } from "./harness.js";
import { EventStore } from "./store.js";

void test("runs one ACP turn and persists normalized events", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "terminal-meta-harness-"));
  const store = new EventStore(join(directory, "history.sqlite"));
  context.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const harness = new TerminalHarness({ provider: "fake", cwd: directory, store });

  await harness.run(async (session) => {
    const events: HarnessEvent[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.kind === "permission_requested")
        session.respondPermission(event.payload.options[0]!.optionId);
    });
    const result = await session.prompt("make a tiny change");
    unsubscribe();

    assert.equal(result.stopReason, "end_turn");
    assert.deepEqual(
      session.history().map((event) => event.kind),
      [
        "user_message",
        "agent_message",
        "tool_call",
        "permission_requested",
        "permission_resolved",
        "turn_finished",
      ],
    );
    const agentMessage = events.find((event) => event.kind === "agent_message");
    assert.equal(agentMessage?.payload.text, "I received: make a tiny change");
  });
});

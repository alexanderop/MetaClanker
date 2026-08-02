#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { render } from "ink";

import { App } from "./App.js";
import { TerminalHarness } from "./harness.js";
import { EventStore, type Provider } from "./store.js";

const provider = readProvider(process.argv[2]);
const cwd = resolve(process.argv[3] ?? ".");
if (!existsSync(cwd)) throw new Error(`Project does not exist: ${cwd}`);

const databasePath = resolve(process.env["META_HARNESS_DB"] ?? ".meta-harness/history.sqlite");
const store = new EventStore(databasePath);
const harness = new TerminalHarness({ provider, cwd, store });

try {
  await harness.run(async (session) => {
    const app = render(<App provider={provider} session={session} />);
    await app.waitUntilExit();
  });
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
} finally {
  store.close();
}

function readProvider(value: string | undefined): Provider {
  if (value === undefined || value === "codex") return "codex";
  if (value === "claude" || value === "fake") return value;
  throw new Error(`Unknown provider: ${value}`);
}

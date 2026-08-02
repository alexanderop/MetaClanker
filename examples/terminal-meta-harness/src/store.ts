import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { HarnessEvent } from "./harness.js";

export type StoredEvent = HarnessEvent & {
  readonly sequence: number;
  readonly recordedAt: string;
};

export class EventStore {
  readonly #database: DatabaseSync;
  readonly #insertSession: StatementSync;
  readonly #insertEvent: StatementSync;
  readonly #selectEvents: StatementSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        started_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        recorded_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
    `);
    this.#insertSession = this.#database.prepare(
      "INSERT OR IGNORE INTO sessions (id, provider, started_at) VALUES (?, ?, ?)",
    );
    this.#insertEvent = this.#database.prepare(
      "INSERT INTO events (session_id, recorded_at, kind, payload) VALUES (?, ?, ?, ?)",
    );
    this.#selectEvents = this.#database.prepare(
      "SELECT sequence, recorded_at, kind, payload FROM events WHERE session_id = ? ORDER BY sequence",
    );
  }

  startSession(sessionId: string, provider: Provider): void {
    this.#insertSession.run(sessionId, provider, new Date().toISOString());
  }

  append(sessionId: string, event: HarnessEvent): void {
    this.#insertEvent.run(
      sessionId,
      new Date().toISOString(),
      event.kind,
      JSON.stringify(event.payload),
    );
  }

  events(sessionId: string): ReadonlyArray<StoredEvent> {
    return this.#selectEvents.all(sessionId).map((row) => {
      if (
        typeof row["sequence"] !== "number" ||
        typeof row["recorded_at"] !== "string" ||
        typeof row["kind"] !== "string" ||
        typeof row["payload"] !== "string"
      ) {
        throw new Error("Invalid event row");
      }
      const payload = JSON.parse(row["payload"]) as unknown;
      return {
        sequence: row["sequence"],
        recordedAt: row["recorded_at"],
        kind: row["kind"],
        payload,
      } as StoredEvent;
    });
  }

  close(): void {
    this.#database.close();
  }
}

export type Provider = "claude" | "codex" | "fake";

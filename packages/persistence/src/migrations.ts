import { SqlClient } from "@effect/sql";
import { Effect, Schema } from "effect";

const ColumnRow = Schema.Struct({ name: Schema.String });

const baseSchema = [
  `CREATE TABLE IF NOT EXISTS environments (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, git_branch TEXT, git_status TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS provider_adapters (id TEXT PRIMARY KEY, provider TEXT NOT NULL, version TEXT NOT NULL, protocol_version INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, provider TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, model TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, status TEXT NOT NULL, prompt TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS command_receipts (command_id TEXT PRIMARY KEY, status TEXT NOT NULL, aggregate_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS side_effect_intents (id TEXT PRIMARY KEY, command_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, schema_version INTEGER NOT NULL DEFAULT 1, event_id TEXT NOT NULL UNIQUE, thread_id TEXT, type TEXT NOT NULL, payload_json TEXT NOT NULL, received_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, turn_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, turn_id TEXT NOT NULL, node_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pending_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, turn_id TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, options_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS agent_nodes (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, parent_id TEXT, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, state TEXT NOT NULL, activity TEXT NOT NULL, child_count INTEGER NOT NULL DEFAULT 0, pending_approval INTEGER NOT NULL DEFAULT 0, changed_file_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS agent_edges (thread_id TEXT NOT NULL, parent_id TEXT NOT NULL, child_id TEXT NOT NULL UNIQUE, PRIMARY KEY (thread_id, parent_id, child_id))`,
  `CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, turn_id TEXT, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
] as const;

export const runMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );

  for (const statement of baseSchema) yield* sql.unsafe(statement);
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))`;

  const addColumn = (table: string, column: string, definition: string) =>
    Effect.gen(function* () {
      const rows = yield* sql.unsafe<{ readonly name: string }>(`PRAGMA table_info(${table})`);
      const columns = yield* Schema.decodeUnknown(Schema.Array(ColumnRow))(rows);
      if (!columns.some((candidate) => candidate.name === column)) {
        yield* sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    });

  yield* addColumn("checkpoints", "checkpoint_json", "TEXT NOT NULL DEFAULT '{}'");
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'))`;

  yield* addColumn("threads", "provider_session_id", "TEXT");
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'))`;

  yield* addColumn("turns", "command_id", "TEXT");
  yield* sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS turns_command_id ON turns(command_id)`);
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, datetime('now'))`;

  yield* addColumn("tool_calls", "sequence", "INTEGER NOT NULL DEFAULT 0");
  yield* addColumn("pending_requests", "sequence", "INTEGER NOT NULL DEFAULT 0");
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, datetime('now'))`;

  const legacyMigration = yield* sql<{ readonly version: number }>`SELECT version
    FROM schema_migrations WHERE version = 6`;
  if (legacyMigration.length === 0) {
    yield* sql`UPDATE events SET schema_version = 0
      WHERE schema_version = 1 AND json_extract(payload_json, '$.origin') IS NULL`;
    yield* sql`INSERT INTO schema_migrations(version, applied_at) VALUES (6, datetime('now'))`;
  }
}).pipe(Effect.withSpan("persistence.migrations"));

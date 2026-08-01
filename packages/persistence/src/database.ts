import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Context, Data, Effect, Layer, Schema } from "effect";

import type {
  MetaClankerStore,
  PersistedCheckpoint,
  StoreError,
  UpsertToolCallRecord,
} from "@metaclanker/application/ports";
import { Store } from "@metaclanker/application/commands";
import {
  AgentNodeId,
  CommandId,
  MessageId,
  PendingInteractionId,
  ProjectId,
  Sequence,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";
import {
  AgentNode,
  CommandReceipt,
  Message,
  PendingInteraction,
  Provider,
  ThreadStatus,
  ToolCall,
  UserSettings,
  defaultUserSettings,
} from "@metaclanker/contracts/wire";
import type { Project, Thread, ThreadDetail } from "@metaclanker/contracts/wire";

class DecodeStoreError extends Data.TaggedError("StoreError")<{
  readonly operation: string;
  readonly message: string;
}> {}

const storeError = (operation: string, cause: unknown): StoreError => ({
  _tag: "StoreError",
  operation,
  message: cause instanceof Error ? cause.message : String(cause),
});

const decode = <A, I>(operation: string, schema: Schema.Schema<A, I, never>, value: unknown) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: (cause) => new DecodeStoreError({ operation, message: String(cause) }),
  });

const parseJson = (value: string): unknown => JSON.parse(value);

const sqliteBoolean = (value: boolean | undefined): number | null => {
  if (value === undefined) return null;
  return value ? 1 : 0;
};

const ProjectRow = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
  git_branch: Schema.NullOr(Schema.String),
  git_status: Schema.Literal("clean", "dirty", "unavailable"),
  hidden: Schema.Number,
  sort_order: Schema.Number,
  created_at: Schema.String,
});

const ThreadRow = Schema.Struct({
  id: ThreadId,
  project_id: ProjectId,
  provider: Provider,
  title: Schema.String,
  status: ThreadStatus,
  model: Schema.NullOr(Schema.String),
  provider_session_id: Schema.NullOr(Schema.String),
  archived: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
});

const MessageRow = Schema.Struct({
  id: MessageId,
  thread_id: ThreadId,
  turn_id: Schema.NullOr(TurnId),
  role: Message.fields.role,
  content: Schema.String,
  sequence: Sequence,
  created_at: Schema.String,
});

const TurnRow = Schema.Struct({
  id: TurnId,
  thread_id: ThreadId,
});

const ToolCallRow = Schema.Struct({
  id: ToolCallId,
  thread_id: ThreadId,
  turn_id: TurnId,
  node_id: AgentNodeId,
  title: Schema.String,
  kind: Schema.String,
  status: ToolCall.fields.status,
  content: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
});

const InteractionRow = Schema.Struct({
  id: PendingInteractionId,
  project_id: ProjectId,
  thread_id: ThreadId,
  turn_id: TurnId,
  node_id: AgentNodeId,
  kind: PendingInteraction.fields.kind,
  title: Schema.String,
  description: Schema.String,
  options_json: Schema.String,
  status: PendingInteraction.fields.status,
  created_at: Schema.String,
});

const AgentNodeRow = Schema.Struct({
  id: AgentNodeId,
  thread_id: ThreadId,
  parent_id: Schema.NullOr(AgentNodeId),
  name: Schema.String,
  provider: Provider,
  model: Schema.NullOr(Schema.String),
  state: AgentNode.fields.state,
  activity: Schema.String,
  child_count: Schema.Number,
  pending_approval: Schema.Number,
  changed_file_count: Schema.Number,
});

const ReceiptRow = Schema.Struct({
  command_id: CommandId,
  status: CommandReceipt.fields.status,
  aggregate_id: Schema.String,
  reason: Schema.NullOr(Schema.String),
  created_at: Schema.String,
});

const CheckpointFileSchema = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  kind: Schema.Literal("tracked", "staged", "untracked", "ignored", "unknown"),
});

const CheckpointSchema = Schema.Struct({
  id: Schema.String,
  projectPath: Schema.String,
  createdAt: Schema.String,
  files: Schema.Array(CheckpointFileSchema),
  snapshotPath: Schema.String,
});

const CheckpointRow = Schema.Struct({
  checkpoint_json: Schema.String,
  thread_id: ThreadId,
  turn_id: Schema.NullOr(TurnId),
  kind: Schema.Literal("pre-turn", "post-turn", "undo"),
});

type ProjectRow = typeof ProjectRow.Type;
type ThreadRow = typeof ThreadRow.Type;
type MessageRow = typeof MessageRow.Type;
type TurnRow = typeof TurnRow.Type;
type ToolCallRow = typeof ToolCallRow.Type;
type InteractionRow = typeof InteractionRow.Type;
type AgentNodeRow = typeof AgentNodeRow.Type;
type ReceiptRow = typeof ReceiptRow.Type;
type CheckpointRow = typeof CheckpointRow.Type;

const projectFromRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  path: row.path,
  gitBranch: row.git_branch,
  gitStatus: row.git_status,
  hidden: row.hidden === 1,
  order: row.sort_order,
  createdAt: row.created_at,
});

const threadFromRow = (row: ThreadRow): Thread => ({
  id: row.id,
  projectId: row.project_id,
  provider: row.provider,
  title: row.title,
  status: row.status,
  model: row.model,
  providerSessionId: row.provider_session_id,
  archived: row.archived === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const messageFromRow = (row: MessageRow): Message => ({
  id: row.id,
  threadId: row.thread_id,
  turnId: row.turn_id,
  role: row.role,
  content: row.content,
  sequence: row.sequence,
  createdAt: row.created_at,
});

const toolCallFromRow = (row: ToolCallRow): ToolCall => ({
  id: row.id,
  threadId: row.thread_id,
  turnId: row.turn_id,
  nodeId: row.node_id,
  title: row.title,
  kind: row.kind,
  status: row.status,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const interactionFromRow = (row: InteractionRow) =>
  decode(
    "decode interaction options",
    PendingInteraction.fields.options,
    parseJson(row.options_json),
  ).pipe(
    Effect.map(
      (options): PendingInteraction => ({
        id: row.id,
        projectId: row.project_id,
        threadId: row.thread_id,
        turnId: row.turn_id,
        nodeId: row.node_id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        options,
        status: row.status,
        createdAt: row.created_at,
      }),
    ),
  );

const agentNodeFromRow = (row: AgentNodeRow): AgentNode => ({
  id: row.id,
  threadId: row.thread_id,
  parentId: row.parent_id,
  name: row.name,
  provider: row.provider,
  model: row.model,
  state: row.state,
  activity: row.activity,
  childCount: row.child_count,
  pendingApproval: row.pending_approval === 1,
  changedFileCount: row.changed_file_count,
});

const receiptFromRow = (row: ReceiptRow): CommandReceipt => ({
  commandId: row.command_id,
  status: row.status,
  aggregateId: row.aggregate_id,
  reason: row.reason,
  createdAt: row.created_at,
});

const migrationStatements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS environments (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, git_branch TEXT, git_status TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS provider_adapters (id TEXT PRIMARY KEY, provider TEXT NOT NULL, version TEXT NOT NULL, protocol_version INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, provider TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, model TEXT, provider_session_id TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, command_id TEXT UNIQUE, status TEXT NOT NULL, prompt TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)`,
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
  `INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))`,
] as const;

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlite = yield* SqliteClient.SqliteClient;

  for (const statement of migrationStatements) {
    yield* sql.unsafe(statement);
  }
  yield* sql
    .unsafe(`ALTER TABLE checkpoints ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}'`)
    .pipe(Effect.catchAll(() => Effect.void));
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at)
    VALUES (2, datetime('now'))`;
  yield* sql
    .unsafe(`ALTER TABLE threads ADD COLUMN provider_session_id TEXT`)
    .pipe(Effect.catchAll(() => Effect.void));
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at)
    VALUES (3, datetime('now'))`;
  yield* sql
    .unsafe(`ALTER TABLE turns ADD COLUMN command_id TEXT`)
    .pipe(Effect.catchAll(() => Effect.void));
  yield* sql.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS turns_command_id ON turns(command_id)`);
  yield* sql`INSERT OR IGNORE INTO schema_migrations(version, applied_at)
    VALUES (4, datetime('now'))`;
  yield* sql`UPDATE pending_requests SET status = 'stale' WHERE status = 'pending'`;
  yield* sql`UPDATE threads SET status = 'recovery-required'
    WHERE status IN ('starting', 'running', 'waiting', 'needs-input', 'cancelling')`;

  const latestSequence = sql<{ readonly sequence: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events
  `.pipe(
    Effect.map((rows) => rows[0]?.sequence ?? 0),
    Effect.flatMap((value) => decode("latest sequence", Sequence, value)),
  );

  const findReceipt: MetaClankerStore["findReceipt"] = (commandId) =>
    sql<ReceiptRow>`SELECT command_id, status, aggregate_id, reason, created_at
      FROM command_receipts WHERE command_id = ${commandId}`.pipe(
      Effect.mapError((cause) => storeError("find command receipt", cause)),
      Effect.flatMap((rows) => decode("find command receipt", Schema.Array(ReceiptRow), rows)),
      Effect.map((rows) => (rows[0] === undefined ? null : receiptFromRow(rows[0]))),
    );

  const saveReceipt: MetaClankerStore["saveReceipt"] = (receipt) =>
    sql`INSERT OR IGNORE INTO command_receipts
      (command_id, status, aggregate_id, reason, created_at)
      VALUES (${receipt.commandId}, ${receipt.status}, ${receipt.aggregateId}, ${receipt.reason}, ${receipt.createdAt})`.pipe(
      Effect.asVoid,
      Effect.mapError((cause) => storeError("save command receipt", cause)),
    );

  const createProject: MetaClankerStore["createProject"] = (input) =>
    Effect.gen(function* () {
      const receipt = yield* findReceipt(input.commandId);
      let projectId =
        receipt === null ? input.id : Schema.decodeUnknownSync(ProjectId)(receipt.aggregateId);

      if (receipt === null) {
        const pathRows = yield* sql<ProjectRow>`SELECT id, name, path, git_branch, git_status,
          hidden, sort_order, created_at FROM projects WHERE path = ${input.path}`;
        const existing = yield* decode(
          "find project by normalized path",
          Schema.Array(ProjectRow),
          pathRows,
        );
        const existingProject = existing[0];
        if (existingProject === undefined) {
          yield* sql`INSERT OR IGNORE INTO projects
            (id, name, path, git_branch, git_status, hidden, sort_order, created_at)
            VALUES (${input.id}, ${input.name}, ${input.path}, ${input.gitBranch}, ${input.gitStatus}, 0,
              (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects), ${input.createdAt})`;
          const persistedRows =
            yield* sql<ProjectRow>`SELECT id, name, path, git_branch, git_status,
            hidden, sort_order, created_at FROM projects WHERE path = ${input.path}`;
          const persisted = yield* decode(
            "resolve project by normalized path",
            Schema.Array(ProjectRow),
            persistedRows,
          );
          const persistedProject = persisted[0];
          if (persistedProject === undefined) {
            return yield* Effect.fail(
              storeError("create project", "Project path was not persisted"),
            );
          }
          projectId = persistedProject.id;
        } else {
          projectId = existingProject.id;
        }
        yield* saveReceipt({
          commandId: input.commandId,
          status: "accepted",
          aggregateId: projectId,
          reason: null,
          createdAt: input.createdAt,
        });
      }

      const rows = yield* sql<ProjectRow>`SELECT id, name, path, git_branch, git_status,
        hidden, sort_order, created_at FROM projects WHERE id = ${projectId}`;
      const decoded = yield* decode("create project", Schema.Array(ProjectRow), rows);
      const row = decoded[0];
      if (row === undefined) {
        return yield* Effect.fail(storeError("create project", "Project was not persisted"));
      }
      return projectFromRow(row);
    }).pipe(
      sql.withTransaction,
      Effect.mapError((cause) => storeError("create project", cause)),
    );

  const getProject = (id: ProjectId) =>
    sql<ProjectRow>`SELECT id, name, path, git_branch, git_status, hidden, sort_order,
      created_at FROM projects WHERE id = ${id}`.pipe(
      Effect.mapError((cause) => storeError("get project", cause)),
      Effect.flatMap((rows) => decode("get project", Schema.Array(ProjectRow), rows)),
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined
          ? Effect.fail(storeError("get project", "Project not found"))
          : Effect.succeed(projectFromRow(row));
      }),
    );

  const getThreadRow = (id: ThreadId) =>
    sql<ThreadRow>`SELECT id, project_id, provider, title, status, model, provider_session_id, archived,
      created_at, updated_at FROM threads WHERE id = ${id}`.pipe(
      Effect.mapError((cause) => storeError("get thread", cause)),
      Effect.flatMap((rows) => decode("get thread", Schema.Array(ThreadRow), rows)),
      Effect.flatMap((rows) => {
        const row = rows[0];
        return row === undefined
          ? Effect.fail(storeError("get thread", "Thread not found"))
          : Effect.succeed(threadFromRow(row));
      }),
    );

  const appendEvent: MetaClankerStore["appendEvent"] = (threadId, type, payload) =>
    Effect.gen(function* () {
      const eventId = crypto.randomUUID();
      yield* sql`INSERT INTO events
        (schema_version, event_id, thread_id, type, payload_json, received_at)
        VALUES (1, ${eventId}, ${threadId}, ${type}, ${payload}, ${new Date().toISOString()})`;
      const rows = yield* sql<{
        readonly sequence: number;
      }>`SELECT last_insert_rowid() AS sequence`;
      return yield* decode("append event", Sequence, rows[0]?.sequence);
    }).pipe(Effect.mapError((cause) => storeError("append event", cause)));

  const service: MetaClankerStore = {
    shellSnapshot: Effect.gen(function* () {
      const projectRows = yield* sql<ProjectRow>`SELECT id, name, path, git_branch, git_status,
        hidden, sort_order, created_at FROM projects ORDER BY sort_order, created_at`;
      const threadRows =
        yield* sql<ThreadRow>`SELECT id, project_id, provider, title, status, model,
        provider_session_id, archived, created_at, updated_at FROM threads ORDER BY updated_at DESC`;
      const projects = yield* decode("shell projects", Schema.Array(ProjectRow), projectRows);
      const threads = yield* decode("shell threads", Schema.Array(ThreadRow), threadRows);
      const sequence = yield* latestSequence;
      return {
        projects: projects.map(projectFromRow),
        threads: threads.map(threadFromRow),
        latestSequence: sequence,
      };
    }).pipe(Effect.mapError((cause) => storeError("shell snapshot", cause))),
    createProject,
    renameProject: (id, name) =>
      sql`UPDATE projects SET name = ${name} WHERE id = ${id}`.pipe(
        Effect.flatMap(() => getProject(id)),
        Effect.mapError((cause) => storeError("rename project", cause)),
      ),
    updateProject: (id, input) =>
      sql`UPDATE projects SET
        name = COALESCE(${input.name ?? null}, name),
        hidden = COALESCE(${sqliteBoolean(input.hidden)}, hidden),
        sort_order = COALESCE(${input.order ?? null}, sort_order)
        WHERE id = ${id}`.pipe(
        Effect.flatMap(() => getProject(id)),
        Effect.mapError((cause) => storeError("update project", cause)),
      ),
    removeProject: (id) =>
      sql`DELETE FROM projects WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError((cause) => storeError("remove project", cause)),
      ),
    createThread: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        const threadId =
          receipt === null ? input.id : Schema.decodeUnknownSync(ThreadId)(receipt.aggregateId);
        if (receipt === null) {
          yield* sql`INSERT INTO threads
            (id, project_id, provider, title, status, model, archived, created_at, updated_at)
            VALUES (${input.id}, ${input.projectId}, ${input.provider}, ${input.title}, 'idle',
              ${input.model}, 0, ${input.createdAt}, ${input.createdAt})`;
          yield* saveReceipt({
            commandId: input.commandId,
            status: "accepted",
            aggregateId: input.id,
            reason: null,
            createdAt: input.createdAt,
          });
        }
        return yield* getThreadRow(threadId);
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("create thread", cause)),
      ),
    startThread: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        if (receipt !== null) {
          const replayedTurnId = yield* decode("replayed first turn", TurnId, receipt.aggregateId);
          const rows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns
            WHERE id = ${replayedTurnId}`;
          const turns = yield* decode("replayed first turn", Schema.Array(TurnRow), rows);
          const replayed = turns[0];
          if (replayed === undefined) {
            return yield* Effect.fail(
              storeError("start thread", "Accepted first-turn receipt has no durable turn"),
            );
          }
          return {
            thread: yield* getThreadRow(replayed.thread_id),
            turnId: replayed.id,
            acceptedNow: false,
          };
        }

        yield* sql`INSERT INTO threads
          (id, project_id, provider, title, status, model, archived, created_at, updated_at)
          VALUES (${input.id}, ${input.projectId}, ${input.provider}, ${input.title}, 'running',
            ${input.model}, 0, ${input.createdAt}, ${input.createdAt})`;
        yield* sql`INSERT INTO turns
          (id, thread_id, command_id, status, prompt, created_at, completed_at)
          VALUES (${input.turnId}, ${input.id}, ${input.commandId}, 'running', ${input.prompt},
            ${input.createdAt}, NULL)`;
        const sequence = yield* appendEvent(
          input.id,
          "turn.started",
          JSON.stringify({ turnId: input.turnId }),
        );
        yield* sql`INSERT INTO messages
          (id, thread_id, turn_id, role, content, sequence, created_at)
          VALUES (${input.userMessageId}, ${input.id}, ${input.turnId}, 'user', ${input.prompt},
            ${sequence}, ${input.createdAt})`;
        yield* sql`INSERT INTO side_effect_intents
          (id, command_id, kind, state, payload_json, created_at, updated_at)
          VALUES (${input.turnId}, ${input.commandId}, 'acp.prompt', 'pending',
            ${JSON.stringify({ threadId: input.id, turnId: input.turnId })}, ${input.createdAt},
            ${input.createdAt})`;
        yield* saveReceipt({
          commandId: input.commandId,
          status: "accepted",
          aggregateId: input.turnId,
          reason: null,
          createdAt: input.createdAt,
        });
        return {
          thread: yield* getThreadRow(input.id),
          turnId: input.turnId,
          acceptedNow: true,
        };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("start thread", cause)),
      ),
    completeTurn: (turnId, status, completedAt) =>
      Effect.gen(function* () {
        const rows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns WHERE id = ${turnId}`;
        const turns = yield* decode("complete turn", Schema.Array(TurnRow), rows);
        const turn = turns[0];
        if (turn === undefined) {
          return yield* Effect.fail(storeError("complete turn", "Turn not found"));
        }
        yield* sql`UPDATE turns SET status = ${status}, completed_at = ${completedAt}
          WHERE id = ${turnId}`;
        yield* sql`UPDATE side_effect_intents SET state = ${status}, updated_at = ${completedAt}
          WHERE id = ${turnId}`;
        yield* appendEvent(turn.thread_id, "turn.completed", JSON.stringify({ turnId, status }));
      }).pipe(
        sql.withTransaction,
        Effect.asVoid,
        Effect.mapError((cause) => storeError("complete turn", cause)),
      ),
    getThread: (id) =>
      Effect.gen(function* () {
        const threadRows = yield* sql<ThreadRow>`SELECT id, project_id, provider, title, status,
          model, provider_session_id, archived, created_at, updated_at FROM threads WHERE id = ${id}`;
        const decodedThreads = yield* decode("thread detail", Schema.Array(ThreadRow), threadRows);
        const thread = decodedThreads[0];
        if (thread === undefined) {
          return null;
        }
        const messageRows = yield* sql<MessageRow>`SELECT id, thread_id, turn_id, role, content,
          sequence, created_at FROM messages WHERE thread_id = ${id} ORDER BY sequence`;
        const toolRows =
          yield* sql<ToolCallRow>`SELECT id, thread_id, turn_id, node_id, title, kind,
          status, content, created_at, updated_at FROM tool_calls WHERE thread_id = ${id}`;
        const interactionRows =
          yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id,
          node_id, kind, title, description, options_json, status, created_at FROM pending_requests
          WHERE thread_id = ${id} ORDER BY created_at`;
        const nodeRows = yield* sql<AgentNodeRow>`SELECT id, thread_id, parent_id, name, provider,
          model, state, activity, child_count, pending_approval, changed_file_count FROM agent_nodes
          WHERE thread_id = ${id}`;
        const messages = yield* decode("thread messages", Schema.Array(MessageRow), messageRows);
        const tools = yield* decode("thread tools", Schema.Array(ToolCallRow), toolRows);
        const interactions = yield* decode(
          "thread interactions",
          Schema.Array(InteractionRow),
          interactionRows,
        );
        const nodes = yield* decode("thread nodes", Schema.Array(AgentNodeRow), nodeRows);
        const decodedInteractions = yield* Effect.all(interactions.map(interactionFromRow));
        const sequence = yield* latestSequence;
        return {
          thread: threadFromRow(thread),
          messages: messages.map(messageFromRow),
          toolCalls: tools.map(toolCallFromRow),
          interactions: decodedInteractions,
          agentNodes: nodes.map(agentNodeFromRow),
          latestSequence: sequence,
        } satisfies ThreadDetail;
      }).pipe(Effect.mapError((cause) => storeError("thread detail", cause))),
    renameThread: (id, title) =>
      sql`UPDATE threads SET title = ${title}, updated_at = ${new Date().toISOString()}
        WHERE id = ${id}`.pipe(
        Effect.flatMap(() => getThreadRow(id)),
        Effect.mapError((cause) => storeError("rename thread", cause)),
      ),
    setThreadArchived: (id, archived) =>
      sql`UPDATE threads SET archived = ${archived ? 1 : 0},
        updated_at = ${new Date().toISOString()} WHERE id = ${id}`.pipe(
        Effect.flatMap(() => getThreadRow(id)),
        Effect.mapError((cause) => storeError("archive thread", cause)),
      ),
    deleteThread: (id) =>
      sql`DELETE FROM threads WHERE id = ${id}`.pipe(
        Effect.asVoid,
        Effect.mapError((cause) => storeError("delete thread", cause)),
      ),
    setThreadStatus: (id, status) =>
      Effect.gen(function* () {
        yield* sql`UPDATE threads SET status = ${status}, updated_at = ${new Date().toISOString()}
          WHERE id = ${id}`;
        return yield* appendEvent(id, "thread.status-changed", JSON.stringify({ status }));
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("set thread status", cause)),
      ),
    setProviderSession: (id, providerSessionId) =>
      sql`UPDATE threads SET provider_session_id = ${providerSessionId},
        updated_at = ${new Date().toISOString()} WHERE id = ${id}`.pipe(
        Effect.flatMap(() => getThreadRow(id)),
        Effect.mapError((cause) => storeError("set provider session", cause)),
      ),
    appendMessage: (input) =>
      Effect.gen(function* () {
        const sequence = yield* appendEvent(
          input.threadId,
          "message.upserted",
          JSON.stringify({ id: input.id, role: input.role }),
        );
        yield* sql`INSERT INTO messages (id, thread_id, turn_id, role, content, sequence, created_at)
          VALUES (${input.id}, ${input.threadId}, ${input.turnId}, ${input.role}, ${input.content},
            ${sequence}, ${input.createdAt})
          ON CONFLICT(id) DO UPDATE SET content = messages.content || excluded.content,
            sequence = excluded.sequence`;
        const rows = yield* sql<MessageRow>`SELECT id, thread_id, turn_id, role, content, sequence,
          created_at FROM messages WHERE id = ${input.id}`;
        const decoded = yield* decode("append message", Schema.Array(MessageRow), rows);
        const row = decoded[0];
        if (row === undefined) {
          return yield* Effect.fail(storeError("append message", "Message projection missing"));
        }
        return messageFromRow(row);
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("append message", cause)),
      ),
    upsertToolCall: (input: UpsertToolCallRecord) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO tool_calls
          (id, thread_id, turn_id, node_id, title, kind, status, content, created_at, updated_at)
          VALUES (${input.id}, ${input.threadId}, ${input.turnId}, ${input.nodeId}, ${input.title},
            ${input.kind}, ${input.status}, ${input.content}, ${input.createdAt}, ${input.updatedAt})
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, content = excluded.content,
            updated_at = excluded.updated_at`;
        yield* appendEvent(input.threadId, "tool.updated", JSON.stringify({ id: input.id }));
        return input;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("upsert tool", cause)),
      ),
    upsertInteraction: (input) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO pending_requests
          (id, project_id, thread_id, turn_id, node_id, kind, title, description, options_json,
            status, created_at)
          VALUES (${input.id}, ${input.projectId}, ${input.threadId}, ${input.turnId}, ${input.nodeId},
            ${input.kind}, ${input.title}, ${input.description}, ${JSON.stringify(input.options)},
            ${input.status}, ${input.createdAt})
          ON CONFLICT(id) DO UPDATE SET status = excluded.status`;
        yield* appendEvent(input.threadId, "interaction.updated", JSON.stringify({ id: input.id }));
        return input;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("upsert interaction", cause)),
      ),
    resolveInteraction: (id, status) =>
      Effect.gen(function* () {
        yield* sql`UPDATE pending_requests SET status = ${status} WHERE id = ${id}`;
        const rows = yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id, node_id,
          kind, title, description, options_json, status, created_at FROM pending_requests
          WHERE id = ${id}`;
        const decoded = yield* decode("resolve interaction", Schema.Array(InteractionRow), rows);
        const row = decoded[0];
        if (row === undefined) {
          return yield* Effect.fail(storeError("resolve interaction", "Interaction not found"));
        }
        yield* appendEvent(row.thread_id, "interaction.updated", JSON.stringify({ id, status }));
        return yield* interactionFromRow(row);
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("resolve interaction", cause)),
      ),
    upsertAgentNode: (input) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO agent_nodes
          (id, thread_id, parent_id, name, provider, model, state, activity, child_count,
            pending_approval, changed_file_count)
          VALUES (${input.id}, ${input.threadId}, ${input.parentId}, ${input.name}, ${input.provider},
            ${input.model}, ${input.state}, ${input.activity}, ${input.childCount},
            ${input.pendingApproval ? 1 : 0}, ${input.changedFileCount})
          ON CONFLICT(id) DO UPDATE SET state = excluded.state, activity = excluded.activity,
            child_count = excluded.child_count, pending_approval = excluded.pending_approval,
            changed_file_count = excluded.changed_file_count`;
        if (input.parentId !== null) {
          yield* sql`INSERT OR IGNORE INTO agent_edges (thread_id, parent_id, child_id)
            VALUES (${input.threadId}, ${input.parentId}, ${input.id})`;
          yield* sql`UPDATE agent_nodes SET child_count = (
            SELECT COUNT(*) FROM agent_edges WHERE parent_id = ${input.parentId}
          ) WHERE id = ${input.parentId}`;
        }
        yield* appendEvent(input.threadId, "agent-node.updated", JSON.stringify({ id: input.id }));
        return input;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("upsert agent node", cause)),
      ),
    appendEvent,
    findReceipt,
    saveReceipt,
    backup: (destination) =>
      sqlite.backup(destination).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => storeError("database backup", cause)),
      ),
    getSettings: sql<{ readonly value_json: string }>`
      SELECT value_json FROM settings WHERE key = 'user'
    `.pipe(
      Effect.mapError((cause) => storeError("get settings", cause)),
      Effect.flatMap((rows) => {
        const value = rows[0]?.value_json;
        if (value === undefined) return Effect.succeed(defaultUserSettings);
        return decode("get settings", UserSettings, parseJson(value));
      }),
    ),
    saveSettings: (settings) =>
      sql`INSERT INTO settings (key, schema_version, value_json, updated_at)
        VALUES ('user', 1, ${JSON.stringify(settings)}, ${new Date().toISOString()})
        ON CONFLICT(key) DO UPDATE SET schema_version = excluded.schema_version,
          value_json = excluded.value_json, updated_at = excluded.updated_at`.pipe(
        Effect.as(settings),
        Effect.mapError((cause) => storeError("save settings", cause)),
      ),
    saveCheckpoint: (record) =>
      sql`INSERT INTO checkpoints (id, thread_id, turn_id, kind, ref, created_at, checkpoint_json)
        VALUES (${record.checkpoint.id}, ${record.threadId}, ${record.turnId}, ${record.kind},
          ${record.checkpoint.snapshotPath}, ${record.checkpoint.createdAt},
          ${JSON.stringify(record.checkpoint)})
        ON CONFLICT(id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json`.pipe(
        Effect.as(record),
        Effect.mapError((cause) => storeError("save checkpoint", cause)),
      ),
    listCheckpoints: (threadId) =>
      sql<CheckpointRow>`SELECT checkpoint_json, thread_id, turn_id, kind FROM checkpoints
        WHERE thread_id = ${threadId} ORDER BY created_at`.pipe(
        Effect.mapError((cause) => storeError("list checkpoints", cause)),
        Effect.flatMap((rows) => decode("checkpoint rows", Schema.Array(CheckpointRow), rows)),
        Effect.flatMap((rows) =>
          Effect.forEach(rows, (row) =>
            decode("checkpoint record", CheckpointSchema, parseJson(row.checkpoint_json)).pipe(
              Effect.map(
                (checkpoint): PersistedCheckpoint => ({
                  checkpoint,
                  threadId: row.thread_id,
                  turnId: row.turn_id,
                  kind: row.kind,
                }),
              ),
            ),
          ),
        ),
      ),
  };

  return service;
});

export const databaseLayer = (filename: string): Layer.Layer<Store, unknown> =>
  Layer.effect(Store, makeStore).pipe(Layer.provide(SqliteClient.layer({ filename })));

export class DatabaseRuntime extends Context.Tag("@metaclanker/persistence/DatabaseRuntime")<
  DatabaseRuntime,
  MetaClankerStore
>() {}

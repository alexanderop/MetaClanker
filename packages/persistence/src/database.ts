import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, Data, Effect, Layer, Schema } from "effect";

import type {
  MetaClankerStore,
  PersistedCheckpoint,
  StoreError,
  PromptIntentLease,
  UpsertToolCallRecord,
} from "@metaclanker/application/ports";
import { Store } from "@metaclanker/application/commands";
import {
  AgentNodeId,
  CommandId,
  EventId,
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
import type { DomainEvent, UnsequencedDomainEvent } from "@metaclanker/domain/events";

import { eventThreadId, UnsequencedDomainEventSchema } from "./eventCodec.js";
import { runMigrations } from "./migrations.js";

class DecodeStoreError extends Data.TaggedError("StoreError")<{
  readonly code: "persistence";
  readonly operation: string;
  readonly message: string;
}> {}

const storeError = (
  operation: string,
  cause: unknown,
  code: StoreError["code"] = "persistence",
): StoreError => ({
  _tag: "StoreError",
  code,
  operation,
  message: cause instanceof Error ? cause.message : String(cause),
});

const decode = <A>(operation: string, schema: Schema.ConstraintDecoder<A, never>, value: unknown) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: (cause) =>
      new DecodeStoreError({ code: "persistence", operation, message: String(cause) }),
  });

const parseJson = (value: string): unknown => JSON.parse(value);

const ProjectRow = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  path: Schema.String,
  git_branch: Schema.NullOr(Schema.String),
  git_status: Schema.Literals(["clean", "dirty", "unavailable"]),
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
  sequence: Sequence,
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
  sequence: Sequence,
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

const EventRow = Schema.Struct({
  sequence: Sequence,
  schema_version: Schema.Literal(1),
  event_id: EventId,
  payload_json: Schema.String,
  received_at: Schema.String,
});

const CheckpointFileSchema = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  kind: Schema.Literals(["tracked", "staged", "untracked", "ignored", "unknown"]),
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
  kind: Schema.Literals(["pre-turn", "post-turn", "undo"]),
});

const PromptIntentRow = Schema.Struct({
  id: TurnId,
  payload_json: Schema.String,
  lease_id: Schema.String,
  attempt: Schema.Natural,
  phase: Schema.Literal("leased"),
});

type ProjectRow = typeof ProjectRow.Type;
type ThreadRow = typeof ThreadRow.Type;
type MessageRow = typeof MessageRow.Type;
type TurnRow = typeof TurnRow.Type;
type ToolCallRow = typeof ToolCallRow.Type;
type InteractionRow = typeof InteractionRow.Type;
type AgentNodeRow = typeof AgentNodeRow.Type;
type ReceiptRow = typeof ReceiptRow.Type;
type EventRow = typeof EventRow.Type;
type CheckpointRow = typeof CheckpointRow.Type;
type PromptIntentRow = typeof PromptIntentRow.Type;

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
  sequence: row.sequence,
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
        sequence: row.sequence,
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

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sqlite = yield* SqliteClient.SqliteClient;

  yield* runMigrations;
  const latestSequence = sql<{ readonly sequence: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE schema_version = 1
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

  const findInteractionById = (id: PendingInteractionId) =>
    Effect.gen(function* () {
      const rows = yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id, node_id,
        kind, title, description, options_json, status, sequence, created_at FROM pending_requests
        WHERE id = ${id}`;
      const decoded = yield* decode("find interaction", Schema.Array(InteractionRow), rows);
      const row = decoded[0];
      return row === undefined ? null : yield* interactionFromRow(row);
    }).pipe(Effect.mapError((cause) => storeError("find interaction", cause)));

  const createProject: MetaClankerStore["createProject"] = (input) =>
    Effect.gen(function* () {
      const receipt = yield* findReceipt(input.commandId);
      let projectId =
        receipt === null ? input.id : Schema.decodeUnknownSync(ProjectId)(receipt.aggregateId);
      let eventSequence: Sequence | null = null;

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
          const orderRows = yield* sql<{ readonly next_order: number }>`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM projects`;
          const project: Project = {
            id: input.id,
            name: input.name,
            path: input.path,
            gitBranch: input.gitBranch,
            gitStatus: input.gitStatus,
            hidden: false,
            order: orderRows[0]?.next_order ?? 0,
            createdAt: input.createdAt,
          };
          eventSequence = yield* appendEvent({
            origin: "client",
            type: "project.upserted",
            project,
          });
          yield* sql`INSERT INTO projects
            (id, name, path, git_branch, git_status, hidden, sort_order, created_at)
            VALUES (${project.id}, ${project.name}, ${project.path}, ${project.gitBranch},
              ${project.gitStatus}, 0, ${project.order}, ${project.createdAt})`;
          projectId = project.id;
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
      return { record: projectFromRow(row), eventSequence };
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

  const appendEvent = (event: UnsequencedDomainEvent) =>
    Effect.gen(function* () {
      const eventId = crypto.randomUUID();
      const receivedAt = new Date().toISOString();
      yield* sql`INSERT INTO events
        (schema_version, event_id, thread_id, type, payload_json, received_at)
        VALUES (1, ${eventId}, ${eventThreadId(event)}, ${event.type}, ${JSON.stringify(event)},
          ${receivedAt})`;
      const rows = yield* sql<{
        readonly sequence: number;
      }>`SELECT last_insert_rowid() AS sequence`;
      return yield* decode("append event", Sequence, rows[0]?.sequence);
    }).pipe(Effect.mapError((cause) => storeError("append event", cause)));

  const readEvents: MetaClankerStore["readEvents"] = (afterSequence, limit) =>
    sql<EventRow>`SELECT sequence, schema_version, event_id, payload_json, received_at
      FROM events WHERE schema_version = 1 AND sequence > ${afterSequence}
      ORDER BY sequence LIMIT ${limit}`.pipe(
      Effect.mapError((cause) => storeError("read events", cause)),
      Effect.flatMap((rows) => decode("event rows", Schema.Array(EventRow), rows)),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          Effect.try({
            try: () => JSON.parse(row.payload_json) as unknown,
            catch: (cause) => storeError("parse event payload", cause),
          }).pipe(
            Effect.flatMap((payload) =>
              decode("domain event payload", UnsequencedDomainEventSchema, payload),
            ),
            Effect.map(
              (payload): DomainEvent => ({
                ...payload,
                schemaVersion: row.schema_version,
                sequence: row.sequence,
                eventId: row.event_id,
                receivedAt: row.received_at,
              }),
            ),
          ),
        ),
      ),
      Effect.mapError((cause) => storeError("read events", cause)),
    );

  yield* Effect.gen(function* () {
    const completed = yield* sql<{ readonly version: number }>`SELECT version
      FROM schema_migrations WHERE version = 7`;
    if (completed.length > 0) return;

    const legacy = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
      FROM events WHERE schema_version = 0`;
    if ((legacy[0]?.count ?? 0) > 0) {
      const projectRows = yield* sql<ProjectRow>`SELECT id, name, path, git_branch, git_status,
        hidden, sort_order, created_at FROM projects ORDER BY sort_order, created_at`;
      const projects = yield* decode("baseline projects", Schema.Array(ProjectRow), projectRows);
      for (const row of projects) {
        yield* appendEvent({
          origin: "server",
          type: "project.upserted",
          project: projectFromRow(row),
        });
      }

      const threadRows =
        yield* sql<ThreadRow>`SELECT id, project_id, provider, title, status, model,
        provider_session_id, archived, created_at, updated_at FROM threads ORDER BY created_at`;
      const threads = yield* decode("baseline threads", Schema.Array(ThreadRow), threadRows);
      for (const row of threads) {
        yield* appendEvent({
          origin: "server",
          type: "thread.upserted",
          thread: threadFromRow(row),
        });
      }

      const messageRows = yield* sql<MessageRow>`SELECT id, thread_id, turn_id, role, content,
        sequence, created_at FROM messages ORDER BY sequence`;
      const messages = yield* decode("baseline messages", Schema.Array(MessageRow), messageRows);
      for (const row of messages) {
        const message = messageFromRow(row);
        const sequence = yield* appendEvent({
          origin: "server",
          type: "message.upserted",
          message: {
            id: message.id,
            threadId: message.threadId,
            turnId: message.turnId,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
          },
        });
        yield* sql`UPDATE messages SET sequence = ${sequence} WHERE id = ${message.id}`;
      }

      const toolRows = yield* sql<ToolCallRow>`SELECT id, thread_id, turn_id, node_id, title, kind,
        status, content, sequence, created_at, updated_at FROM tool_calls ORDER BY sequence`;
      const tools = yield* decode("baseline tools", Schema.Array(ToolCallRow), toolRows);
      for (const row of tools) {
        const toolCall = toolCallFromRow(row);
        const sequence = yield* appendEvent({
          origin: "server",
          type: "tool.upserted",
          toolCall: {
            id: toolCall.id,
            threadId: toolCall.threadId,
            turnId: toolCall.turnId,
            nodeId: toolCall.nodeId,
            title: toolCall.title,
            kind: toolCall.kind,
            status: toolCall.status,
            content: toolCall.content,
            createdAt: toolCall.createdAt,
            updatedAt: toolCall.updatedAt,
          },
        });
        yield* sql`UPDATE tool_calls SET sequence = ${sequence} WHERE id = ${toolCall.id}`;
      }

      const interactionRows = yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id,
        node_id, kind, title, description, options_json, status, sequence, created_at
        FROM pending_requests ORDER BY sequence`;
      const interactions = yield* decode(
        "baseline interactions",
        Schema.Array(InteractionRow),
        interactionRows,
      );
      for (const row of interactions) {
        const interaction = yield* interactionFromRow(row);
        const sequence = yield* appendEvent({
          origin: "server",
          type: "interaction.upserted",
          interaction: {
            id: interaction.id,
            projectId: interaction.projectId,
            threadId: interaction.threadId,
            turnId: interaction.turnId,
            nodeId: interaction.nodeId,
            kind: interaction.kind,
            title: interaction.title,
            description: interaction.description,
            options: interaction.options,
            status: interaction.status,
            createdAt: interaction.createdAt,
          },
        });
        yield* sql`UPDATE pending_requests SET sequence = ${sequence}
          WHERE id = ${interaction.id}`;
      }

      const nodeRows = yield* sql<AgentNodeRow>`SELECT id, thread_id, parent_id, name, provider,
        model, state, activity, child_count, pending_approval, changed_file_count
        FROM agent_nodes ORDER BY id`;
      const nodes = yield* decode("baseline agent nodes", Schema.Array(AgentNodeRow), nodeRows);
      for (const row of nodes) {
        yield* appendEvent({
          origin: "server",
          type: "agent-node.upserted",
          node: agentNodeFromRow(row),
        });
      }

      const checkpointRows = yield* sql<CheckpointRow>`SELECT checkpoint_json, thread_id,
        turn_id, kind FROM checkpoints ORDER BY created_at`;
      const checkpoints = yield* decode(
        "baseline checkpoints",
        Schema.Array(CheckpointRow),
        checkpointRows,
      );
      for (const row of checkpoints) {
        const checkpoint = yield* decode(
          "baseline checkpoint",
          CheckpointSchema,
          parseJson(row.checkpoint_json),
        );
        yield* appendEvent({
          origin: "git",
          type: "checkpoint.saved",
          record: {
            checkpoint,
            threadId: row.thread_id,
            turnId: row.turn_id,
            kind: row.kind,
          },
        });
      }

      const settingsRows = yield* sql<{ readonly value_json: string }>`SELECT value_json
        FROM settings WHERE key = 'user'`;
      const settingsValue = settingsRows[0]?.value_json;
      if (settingsValue !== undefined) {
        const settings = yield* decode("baseline settings", UserSettings, parseJson(settingsValue));
        yield* appendEvent({ origin: "server", type: "settings.saved", settings });
      }
    }
    yield* sql`INSERT INTO schema_migrations(version, applied_at) VALUES (7, datetime('now'))`;
  }).pipe(sql.withTransaction);

  yield* Effect.gen(function* () {
    const pendingRows = yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id,
      node_id, kind, title, description, options_json, status, sequence, created_at
      FROM pending_requests WHERE status IN ('pending', 'dispatching')`;
    const pending = yield* decode(
      "recover pending interactions",
      Schema.Array(InteractionRow),
      pendingRows,
    );
    for (const row of pending) {
      const current = yield* interactionFromRow(row);
      const interaction = { ...current, status: "stale" as const };
      yield* appendEvent({
        origin: "server",
        type: "interaction.upserted",
        interaction: {
          id: interaction.id,
          projectId: interaction.projectId,
          threadId: interaction.threadId,
          turnId: interaction.turnId,
          nodeId: interaction.nodeId,
          kind: interaction.kind,
          title: interaction.title,
          description: interaction.description,
          options: interaction.options,
          status: interaction.status,
          createdAt: interaction.createdAt,
        },
      });
      yield* sql`UPDATE pending_requests SET status = 'stale' WHERE id = ${interaction.id}`;
      yield* sql`UPDATE side_effect_intents
        SET state = 'uncertain', phase = 'completed', failure_reason = 'recovery-required',
          lease_id = NULL, lease_expires_at = NULL, updated_at = ${interaction.createdAt}
        WHERE kind = 'acp.interaction-response' AND state IN ('pending', 'running')
          AND json_extract(payload_json, '$.interactionId') = ${interaction.id}`;
    }

    const restoreRows = yield* sql<{
      readonly id: string;
      readonly payload_json: string;
    }>`SELECT id,
      payload_json FROM side_effect_intents WHERE kind = 'git.restore'
        AND state IN ('pending', 'running')`;
    for (const restore of restoreRows) {
      const payload = yield* decode(
        "recover restore intent",
        Schema.Struct({ threadId: ThreadId }),
        parseJson(restore.payload_json),
      );
      const updatedAt = new Date().toISOString();
      yield* appendEvent({
        origin: "server",
        type: "thread.status-changed",
        threadId: payload.threadId,
        status: "recovery-required",
        updatedAt,
      });
      yield* sql`UPDATE threads SET status = 'recovery-required', updated_at = ${updatedAt}
        WHERE id = ${payload.threadId}`;
      yield* sql`UPDATE side_effect_intents
        SET state = 'uncertain', phase = 'completed', failure_reason = 'restore-uncertain',
          lease_id = NULL, lease_expires_at = NULL, updated_at = ${updatedAt}
        WHERE id = ${restore.id}`;
    }

    const runningTurnRows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns
      WHERE status = 'running'`;
    const runningTurns = yield* decode(
      "recover active turns",
      Schema.Array(TurnRow),
      runningTurnRows,
    );
    for (const turn of runningTurns) {
      const completedAt = new Date().toISOString();
      yield* appendEvent({
        origin: "server",
        type: "turn.completed",
        threadId: turn.thread_id,
        turnId: turn.id,
        outcome: "recovery-required",
      });
      yield* sql`UPDATE turns SET status = 'recovery-required', completed_at = ${completedAt}
        WHERE id = ${turn.id}`;
      yield* sql`UPDATE side_effect_intents
        SET state = 'uncertain', phase = 'completed', failure_reason = 'recovery-required',
          lease_id = NULL, lease_expires_at = NULL, updated_at = ${completedAt}
        WHERE id IN (${turn.id}, ${`cancel:${turn.id}`}) AND state IN ('pending', 'running')`;
    }

    const activeRows = yield* sql<ThreadRow>`SELECT id, project_id, provider, title, status, model,
      provider_session_id, archived, created_at, updated_at FROM threads
      WHERE status IN ('starting', 'running', 'waiting', 'needs-input', 'cancelling')`;
    const active = yield* decode("recover active threads", Schema.Array(ThreadRow), activeRows);
    for (const row of active) {
      const updatedAt = new Date().toISOString();
      yield* appendEvent({
        origin: "server",
        type: "thread.status-changed",
        threadId: row.id,
        status: "recovery-required",
        updatedAt,
      });
      yield* sql`UPDATE threads SET status = 'recovery-required', updated_at = ${updatedAt}
        WHERE id = ${row.id}`;
    }
  }).pipe(sql.withTransaction);

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
      Effect.gen(function* () {
        const project = { ...(yield* getProject(id)), name };
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "project.upserted",
          project,
        });
        yield* sql`UPDATE projects SET name = ${name} WHERE id = ${id}`;
        return { record: project, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("rename project", cause)),
      ),
    updateProject: (id, input) =>
      Effect.gen(function* () {
        const current = yield* getProject(id);
        const project: Project = {
          ...current,
          name: input.name ?? current.name,
          hidden: input.hidden ?? current.hidden,
          order: input.order ?? current.order,
        };
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "project.upserted",
          project,
        });
        yield* sql`UPDATE projects SET name = ${project.name}, hidden = ${project.hidden ? 1 : 0},
          sort_order = ${project.order} WHERE id = ${id}`;
        return { record: project, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("update project", cause)),
      ),
    removeProject: (id) =>
      Effect.gen(function* () {
        yield* getProject(id);
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "project.removed",
          projectId: id,
        });
        yield* sql`DELETE FROM projects WHERE id = ${id}`;
        return { record: id, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("remove project", cause)),
      ),
    createThread: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        const threadId =
          receipt === null ? input.id : Schema.decodeUnknownSync(ThreadId)(receipt.aggregateId);
        let eventSequence: Sequence | null = null;
        if (receipt === null) {
          const thread: Thread = {
            id: input.id,
            projectId: input.projectId,
            provider: input.provider,
            title: input.title,
            status: "idle",
            model: input.model,
            providerSessionId: null,
            archived: false,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          };
          eventSequence = yield* appendEvent({
            origin: "client",
            type: "thread.upserted",
            thread,
          });
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
        return { record: yield* getThreadRow(threadId), eventSequence };
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
            threadEventSequence: null,
          };
        }

        const thread: Thread = {
          id: input.id,
          projectId: input.projectId,
          provider: input.provider,
          title: input.title,
          status: "running",
          model: input.model,
          providerSessionId: null,
          archived: false,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        };
        const threadEventSequence = yield* appendEvent({
          origin: "client",
          type: "thread.upserted",
          thread,
        });
        yield* sql`INSERT INTO threads
          (id, project_id, provider, title, status, model, archived, created_at, updated_at)
          VALUES (${input.id}, ${input.projectId}, ${input.provider}, ${input.title}, 'running',
            ${input.model}, 0, ${input.createdAt}, ${input.createdAt})`;
        yield* sql`INSERT INTO turns
          (id, thread_id, command_id, status, prompt, created_at, completed_at)
          VALUES (${input.turnId}, ${input.id}, ${input.commandId}, 'running', ${input.prompt},
            ${input.createdAt}, NULL)`;
        yield* appendEvent({
          origin: "client",
          type: "turn.started",
          threadId: input.id,
          turnId: input.turnId,
        });
        const sequence = yield* appendEvent({
          origin: "client",
          type: "message.upserted",
          message: {
            id: input.userMessageId,
            threadId: input.id,
            turnId: input.turnId,
            role: "user",
            content: input.prompt,
            createdAt: input.createdAt,
          },
        });
        yield* sql`INSERT INTO messages
          (id, thread_id, turn_id, role, content, sequence, created_at)
          VALUES (${input.userMessageId}, ${input.id}, ${input.turnId}, 'user', ${input.prompt},
            ${sequence}, ${input.createdAt})`;
        yield* sql`INSERT INTO side_effect_intents
          (id, command_id, kind, state, phase, payload_json, created_at, updated_at)
          VALUES (${input.turnId}, ${input.commandId}, 'acp.prompt', 'pending', 'admitted',
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
          threadEventSequence,
        };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("start thread", cause)),
      ),
    startTurn: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        if (receipt !== null) {
          const replayedTurnId = yield* decode("replayed turn", TurnId, receipt.aggregateId);
          const rows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns
            WHERE id = ${replayedTurnId}`;
          const turns = yield* decode("replayed turn", Schema.Array(TurnRow), rows);
          const replayed = turns[0];
          if (replayed === undefined) {
            return yield* Effect.fail(
              storeError("start turn", "Accepted turn receipt has no durable turn"),
            );
          }
          return {
            acceptedNow: false as const,
            thread: yield* getThreadRow(replayed.thread_id),
            turnId: replayed.id,
          };
        }

        const activeRows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns
          WHERE thread_id = ${input.threadId} AND status = 'running'`;
        const active = yield* decode("active turn", Schema.Array(TurnRow), activeRows);
        if (active.length > 0) {
          return yield* Effect.fail(
            storeError("start turn", "This thread already has an active turn", "conflict"),
          );
        }

        const current = yield* getThreadRow(input.threadId);
        const thread: Thread = {
          ...current,
          status: "running",
          updatedAt: input.createdAt,
        };
        const statusEventSequence = yield* appendEvent({
          origin: "client",
          type: "thread.status-changed",
          threadId: input.threadId,
          status: "running",
          updatedAt: input.createdAt,
        });
        yield* sql`UPDATE threads SET status = 'running', updated_at = ${input.createdAt}
          WHERE id = ${input.threadId}`;
        yield* sql`INSERT INTO turns
          (id, thread_id, command_id, status, prompt, created_at, completed_at)
          VALUES (${input.turnId}, ${input.threadId}, ${input.commandId}, 'running', ${input.prompt},
            ${input.createdAt}, NULL)`;
        yield* appendEvent({
          origin: "client",
          type: "turn.started",
          threadId: input.threadId,
          turnId: input.turnId,
        });
        const messageEventSequence = yield* appendEvent({
          origin: "client",
          type: "message.upserted",
          message: {
            id: input.userMessageId,
            threadId: input.threadId,
            turnId: input.turnId,
            role: "user",
            content: input.prompt,
            createdAt: input.createdAt,
          },
        });
        const userMessage: Message = {
          id: input.userMessageId,
          threadId: input.threadId,
          turnId: input.turnId,
          role: "user",
          content: input.prompt,
          sequence: messageEventSequence,
          createdAt: input.createdAt,
        };
        yield* sql`INSERT INTO messages
          (id, thread_id, turn_id, role, content, sequence, created_at)
          VALUES (${userMessage.id}, ${userMessage.threadId}, ${userMessage.turnId}, 'user',
            ${userMessage.content}, ${userMessage.sequence}, ${userMessage.createdAt})`;
        const nodeEventSequence = yield* appendEvent({
          origin: "server",
          type: "agent-node.upserted",
          node: input.rootNode,
        });
        yield* sql`INSERT INTO agent_nodes
          (id, thread_id, parent_id, name, provider, model, state, activity, child_count,
            pending_approval, changed_file_count)
          VALUES (${input.rootNode.id}, ${input.rootNode.threadId}, ${input.rootNode.parentId},
            ${input.rootNode.name}, ${input.rootNode.provider}, ${input.rootNode.model},
            ${input.rootNode.state}, ${input.rootNode.activity}, ${input.rootNode.childCount},
            ${input.rootNode.pendingApproval ? 1 : 0}, ${input.rootNode.changedFileCount})
          ON CONFLICT(id) DO UPDATE SET state = excluded.state, activity = excluded.activity,
            child_count = excluded.child_count, pending_approval = excluded.pending_approval,
            changed_file_count = excluded.changed_file_count`;
        yield* sql`INSERT INTO side_effect_intents
          (id, command_id, kind, state, phase, payload_json, created_at, updated_at)
          VALUES (${input.turnId}, ${input.commandId}, 'acp.prompt', 'pending', 'admitted',
            ${JSON.stringify({ threadId: input.threadId, turnId: input.turnId, attachments: input.attachments })},
            ${input.createdAt}, ${input.createdAt})`;
        yield* saveReceipt({
          commandId: input.commandId,
          status: "accepted",
          aggregateId: input.turnId,
          reason: null,
          createdAt: input.createdAt,
        });
        return {
          acceptedNow: true as const,
          thread,
          turnId: input.turnId,
          userMessage,
          rootNode: input.rootNode,
          statusEventSequence,
          messageEventSequence,
          nodeEventSequence,
        };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("start turn", cause)),
      ),
    admitCancel: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        if (receipt !== null) {
          const turnId = yield* decode("replayed cancellation", TurnId, receipt.aggregateId);
          return { acceptedNow: false, turnId, eventSequence: null } as const;
        }
        const rows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns
          WHERE thread_id = ${input.threadId} AND status = 'running'`;
        const activeTurns = yield* decode("active cancellation turn", Schema.Array(TurnRow), rows);
        const activeTurn = activeTurns[0];
        if (activeTurn === undefined) {
          return yield* Effect.fail(storeError("admit cancellation", "No active turn", "conflict"));
        }
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "thread.status-changed",
          threadId: input.threadId,
          status: "cancelling",
          updatedAt: input.createdAt,
        });
        yield* sql`UPDATE threads SET status = 'cancelling', updated_at = ${input.createdAt}
          WHERE id = ${input.threadId}`;
        yield* sql`INSERT INTO side_effect_intents
          (id, command_id, kind, state, phase, lease_id, payload_json, created_at, updated_at)
          VALUES (${`cancel:${activeTurn.id}`}, ${input.commandId}, 'acp.cancel', 'running',
            'dispatching-provider', ${input.leaseId},
            ${JSON.stringify({ threadId: input.threadId, turnId: activeTurn.id })},
            ${input.createdAt}, ${input.createdAt})`;
        yield* saveReceipt({
          commandId: input.commandId,
          status: "accepted",
          aggregateId: activeTurn.id,
          reason: null,
          createdAt: input.createdAt,
        });
        return {
          acceptedNow: true,
          turnId: activeTurn.id,
          eventSequence,
          leaseId: input.leaseId,
        } as const;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("admit cancellation", cause)),
      ),
    markCancelAwaiting: (turnId, leaseId, updatedAt) =>
      sql`UPDATE side_effect_intents
        SET phase = 'awaiting-provider', updated_at = ${updatedAt}
        WHERE id = ${`cancel:${turnId}`} AND kind = 'acp.cancel' AND state = 'running'
          AND lease_id = ${leaseId}
        RETURNING id`.pipe(
        Effect.map((result) => result.length === 1),
        Effect.mapError((cause) => storeError("mark cancellation awaiting", cause)),
      ),
    markCancelUncertain: (turnId, leaseId, updatedAt) =>
      sql`UPDATE side_effect_intents
        SET state = 'uncertain', phase = 'completed', failure_reason = 'provider-cancel-uncertain',
          lease_id = NULL, lease_expires_at = NULL, updated_at = ${updatedAt}
        WHERE id = ${`cancel:${turnId}`} AND kind = 'acp.cancel' AND state = 'running'
          AND lease_id = ${leaseId}
        RETURNING id`.pipe(
        Effect.map((result) => result.length === 1),
        Effect.mapError((cause) => storeError("mark cancellation uncertain", cause)),
      ),
    admitRestore: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        if (receipt !== null) {
          return { acceptedNow: false, undoCheckpointId: receipt.aggregateId } as const;
        }
        yield* getThreadRow(input.threadId);
        const activeRows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns
          WHERE thread_id = ${input.threadId} AND status IN ('running', 'cancelling')`;
        const activeTurns = yield* decode(
          "active restore turns",
          Schema.Array(TurnRow),
          activeRows,
        );
        if (activeTurns.length > 0) {
          return yield* Effect.fail(
            storeError(
              "admit restore",
              "Files can be restored only while the session is idle",
              "conflict",
            ),
          );
        }
        const liveRestores = yield* sql<{ readonly id: string }>`SELECT id FROM side_effect_intents
          WHERE kind = 'git.restore' AND state IN ('pending', 'running')
            AND json_extract(payload_json, '$.threadId') = ${input.threadId}`;
        if (liveRestores.length > 0) {
          return yield* Effect.fail(
            storeError("admit restore", "A file restore is already in progress", "conflict"),
          );
        }
        yield* sql`INSERT INTO side_effect_intents
          (id, command_id, kind, state, phase, lease_id, payload_json, created_at, updated_at)
          VALUES (${`restore:${input.commandId}`}, ${input.commandId}, 'git.restore', 'running',
            'dispatching-provider', ${input.leaseId},
            ${JSON.stringify({
              threadId: input.threadId,
              checkpointId: input.checkpointId,
              undoCheckpointId: input.undoCheckpointId,
            })}, ${input.createdAt}, ${input.createdAt})`;
        yield* saveReceipt({
          commandId: input.commandId,
          status: "accepted",
          aggregateId: input.undoCheckpointId,
          reason: null,
          createdAt: input.createdAt,
        });
        return {
          acceptedNow: true,
          undoCheckpointId: input.undoCheckpointId,
          leaseId: input.leaseId,
        } as const;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("admit restore", cause)),
      ),
    completeRestore: (commandId, leaseId, record) =>
      Effect.gen(function* () {
        const completed = yield* sql<{ readonly id: string }>`UPDATE side_effect_intents
          SET state = 'succeeded', phase = 'completed', lease_id = NULL, lease_expires_at = NULL,
            updated_at = ${record.checkpoint.createdAt}
          WHERE id = ${`restore:${commandId}`} AND kind = 'git.restore' AND state = 'running'
            AND lease_id = ${leaseId}
          RETURNING id`;
        if (completed.length !== 1) return null;
        yield* appendEvent({ origin: "git", type: "checkpoint.saved", record });
        yield* sql`INSERT INTO checkpoints (id, thread_id, turn_id, kind, ref, created_at, checkpoint_json)
          VALUES (${record.checkpoint.id}, ${record.threadId}, ${record.turnId}, ${record.kind},
            ${record.checkpoint.snapshotPath}, ${record.checkpoint.createdAt},
            ${JSON.stringify(record.checkpoint)})
          ON CONFLICT(id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json`;
        return record;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("complete restore", cause)),
      ),
    markRestoreUncertain: (commandId, leaseId, threadId, updatedAt) =>
      Effect.gen(function* () {
        const uncertain = yield* sql<{ readonly id: string }>`UPDATE side_effect_intents
          SET state = 'uncertain', phase = 'completed', failure_reason = 'restore-uncertain',
            lease_id = NULL, lease_expires_at = NULL, updated_at = ${updatedAt}
          WHERE id = ${`restore:${commandId}`} AND kind = 'git.restore' AND state = 'running'
            AND lease_id = ${leaseId}
          RETURNING id`;
        if (uncertain.length !== 1) return null;
        const eventSequence = yield* appendEvent({
          origin: "server",
          type: "thread.status-changed",
          threadId,
          status: "recovery-required",
          updatedAt,
        });
        yield* sql`UPDATE threads SET status = 'recovery-required', updated_at = ${updatedAt}
          WHERE id = ${threadId}`;
        return eventSequence;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("mark restore uncertain", cause)),
      ),
    completeTurn: (turnId, status, completedAt) =>
      Effect.gen(function* () {
        let intentState = "succeeded";
        if (status === "recovery-required") intentState = "uncertain";
        else if (status === "failed") intentState = "failed";
        let cancellationState = "failed";
        if (status === "cancelled") cancellationState = "succeeded";
        else if (status === "recovery-required") cancellationState = "uncertain";
        const rows = yield* sql<TurnRow>`SELECT id, thread_id FROM turns WHERE id = ${turnId}`;
        const turns = yield* decode("complete turn", Schema.Array(TurnRow), rows);
        const turn = turns[0];
        if (turn === undefined) {
          return yield* Effect.fail(storeError("complete turn", "Turn not found"));
        }
        yield* sql`UPDATE turns SET status = ${status}, completed_at = ${completedAt}
          WHERE id = ${turnId}`;
        yield* sql`UPDATE side_effect_intents
          SET state = ${intentState}, phase = 'completed', lease_id = NULL, lease_expires_at = NULL,
            updated_at = ${completedAt}
          WHERE id = ${turnId}`;
        yield* sql`UPDATE side_effect_intents
          SET state = ${cancellationState}, phase = 'completed', lease_id = NULL,
            lease_expires_at = NULL, updated_at = ${completedAt}
          WHERE id = ${`cancel:${turnId}`} AND kind = 'acp.cancel' AND state = 'running'`;
        yield* appendEvent({
          origin: "server",
          type: "turn.completed",
          threadId: turn.thread_id,
          turnId,
          outcome: status,
        });
      }).pipe(
        sql.withTransaction,
        Effect.asVoid,
        Effect.mapError((cause) => storeError("complete turn", cause)),
      ),
    claimPromptIntent: (turnId, leaseId, leaseExpiresAt) =>
      Effect.gen(function* () {
        const rows = yield* sql<PromptIntentRow>`UPDATE side_effect_intents
          SET state = 'running', phase = 'leased', lease_id = ${leaseId},
            lease_expires_at = ${leaseExpiresAt}, attempt = attempt + 1, updated_at = ${leaseExpiresAt}
          WHERE id = ${turnId} AND kind = 'acp.prompt' AND state = 'pending'
            AND phase IN ('admitted', 'scheduling-failed')
          RETURNING id, payload_json, lease_id, attempt, phase`;
        const claimed = yield* decode("claim prompt intent", Schema.Array(PromptIntentRow), rows);
        const row = claimed[0];
        if (row === undefined) return null;
        const payload = yield* decode(
          "claim prompt intent payload",
          Schema.Struct({ threadId: ThreadId, turnId: TurnId }),
          parseJson(row.payload_json),
        );
        return {
          intentId: row.id,
          threadId: payload.threadId,
          turnId: payload.turnId,
          leaseId: row.lease_id,
          attempt: row.attempt,
          phase: row.phase,
        } satisfies PromptIntentLease;
      }).pipe(Effect.mapError((cause) => storeError("claim prompt intent", cause))),
    transitionPromptIntent: (turnId, leaseId, phase, updatedAt, failureReason) =>
      Effect.gen(function* () {
        const state = phase === "completed" ? "succeeded" : "running";
        const rows = yield* sql<{ readonly id: TurnId }>`UPDATE side_effect_intents
          SET state = ${state}, phase = ${phase}, failure_reason = ${failureReason ?? null},
            lease_id = CASE WHEN ${phase} = 'completed' THEN NULL ELSE lease_id END,
            lease_expires_at = CASE WHEN ${phase} = 'completed' THEN NULL ELSE lease_expires_at END,
            updated_at = ${updatedAt}
          WHERE id = ${turnId} AND kind = 'acp.prompt' AND state = 'running' AND lease_id = ${leaseId}
          RETURNING id`;
        return rows.length === 1;
      }).pipe(Effect.mapError((cause) => storeError("transition prompt intent", cause))),
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
          status, content, sequence, created_at, updated_at FROM tool_calls WHERE thread_id = ${id}`;
        const interactionRows =
          yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id,
          node_id, kind, title, description, options_json, status, sequence, created_at FROM pending_requests
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
      Effect.gen(function* () {
        const current = yield* getThreadRow(id);
        const thread = { ...current, title, updatedAt: new Date().toISOString() };
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "thread.upserted",
          thread,
        });
        yield* sql`UPDATE threads SET title = ${thread.title}, updated_at = ${thread.updatedAt}
          WHERE id = ${id}`;
        return { record: thread, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("rename thread", cause)),
      ),
    setThreadArchived: (id, archived) =>
      Effect.gen(function* () {
        const current = yield* getThreadRow(id);
        const thread = { ...current, archived, updatedAt: new Date().toISOString() };
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "thread.upserted",
          thread,
        });
        yield* sql`UPDATE threads SET archived = ${archived ? 1 : 0},
          updated_at = ${thread.updatedAt} WHERE id = ${id}`;
        return { record: thread, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("archive thread", cause)),
      ),
    deleteThread: (id) =>
      Effect.gen(function* () {
        yield* getThreadRow(id);
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "thread.removed",
          threadId: id,
        });
        yield* sql`DELETE FROM threads WHERE id = ${id}`;
        return { record: id, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("delete thread", cause)),
      ),
    setThreadStatus: (id, status) =>
      Effect.gen(function* () {
        const updatedAt = new Date().toISOString();
        const sequence = yield* appendEvent({
          origin: "server",
          type: "thread.status-changed",
          threadId: id,
          status,
          updatedAt,
        });
        yield* sql`UPDATE threads SET status = ${status}, updated_at = ${updatedAt}
          WHERE id = ${id}`;
        return sequence;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("set thread status", cause)),
      ),
    setProviderSession: (id, providerSessionId) =>
      Effect.gen(function* () {
        const current = yield* getThreadRow(id);
        const thread = {
          ...current,
          providerSessionId,
          updatedAt: new Date().toISOString(),
        };
        const eventSequence = yield* appendEvent({
          origin: "server",
          type: "thread.upserted",
          thread,
        });
        yield* sql`UPDATE threads SET provider_session_id = ${providerSessionId},
          updated_at = ${thread.updatedAt} WHERE id = ${id}`;
        return { record: thread, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("set provider session", cause)),
      ),
    appendMessage: (input) =>
      Effect.gen(function* () {
        const existingRows = yield* sql<MessageRow>`SELECT id, thread_id, turn_id, role, content,
          sequence, created_at FROM messages WHERE id = ${input.id}`;
        const existing = yield* decode("existing message", Schema.Array(MessageRow), existingRows);
        const content = `${existing[0]?.content ?? ""}${input.content}`;
        const sequence = yield* appendEvent({
          origin: input.role === "user" ? "client" : "provider",
          type: "message.upserted",
          message: { ...input, content },
        });
        yield* sql`INSERT INTO messages (id, thread_id, turn_id, role, content, sequence, created_at)
          VALUES (${input.id}, ${input.threadId}, ${input.turnId}, ${input.role}, ${content},
            ${sequence}, ${input.createdAt})
          ON CONFLICT(id) DO UPDATE SET content = excluded.content`;
        const rows = yield* sql<MessageRow>`SELECT id, thread_id, turn_id, role, content, sequence,
          created_at FROM messages WHERE id = ${input.id}`;
        const decoded = yield* decode("append message", Schema.Array(MessageRow), rows);
        const row = decoded[0];
        if (row === undefined) {
          return yield* Effect.fail(storeError("append message", "Message projection missing"));
        }
        return { record: messageFromRow(row), eventSequence: sequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("append message", cause)),
      ),
    upsertToolCall: (input: UpsertToolCallRecord) =>
      Effect.gen(function* () {
        const sequence = yield* appendEvent({
          origin: "provider",
          type: "tool.upserted",
          toolCall: input,
        });
        yield* sql`INSERT INTO tool_calls
          (id, thread_id, turn_id, node_id, title, kind, status, content, sequence, created_at, updated_at)
          VALUES (${input.id}, ${input.threadId}, ${input.turnId}, ${input.nodeId}, ${input.title},
            ${input.kind}, ${input.status}, ${input.content}, ${sequence}, ${input.createdAt}, ${input.updatedAt})
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, content = excluded.content,
            updated_at = excluded.updated_at`;
        const rows = yield* sql<ToolCallRow>`SELECT id, thread_id, turn_id, node_id, title, kind,
          status, content, sequence, created_at, updated_at FROM tool_calls WHERE id = ${input.id}`;
        const decoded = yield* decode("upserted tool", Schema.Array(ToolCallRow), rows);
        const row = decoded[0];
        if (row === undefined) {
          return yield* Effect.fail(storeError("upsert tool", "Tool projection missing"));
        }
        return { record: toolCallFromRow(row), eventSequence: sequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("upsert tool", cause)),
      ),
    upsertInteraction: (input) =>
      Effect.gen(function* () {
        const sequence = yield* appendEvent({
          origin: "provider",
          type: "interaction.upserted",
          interaction: input,
        });
        yield* sql`INSERT INTO pending_requests
          (id, project_id, thread_id, turn_id, node_id, kind, title, description, options_json,
            status, sequence, created_at)
          VALUES (${input.id}, ${input.projectId}, ${input.threadId}, ${input.turnId}, ${input.nodeId},
            ${input.kind}, ${input.title}, ${input.description}, ${JSON.stringify(input.options)},
            ${input.status}, ${sequence}, ${input.createdAt})
          ON CONFLICT(id) DO UPDATE SET status = excluded.status`;
        const rows = yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id, node_id,
          kind, title, description, options_json, status, sequence, created_at FROM pending_requests
          WHERE id = ${input.id}`;
        const decoded = yield* decode("upserted interaction", Schema.Array(InteractionRow), rows);
        const row = decoded[0];
        if (row === undefined) {
          return yield* Effect.fail(
            storeError("upsert interaction", "Interaction projection missing"),
          );
        }
        return {
          record: yield* interactionFromRow(row),
          eventSequence: sequence,
        };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("upsert interaction", cause)),
      ),
    findInteraction: findInteractionById,
    resolveInteraction: (id, status) =>
      Effect.gen(function* () {
        yield* sql`UPDATE pending_requests SET status = ${status} WHERE id = ${id}`;
        const rows = yield* sql<InteractionRow>`SELECT id, project_id, thread_id, turn_id, node_id,
          kind, title, description, options_json, status, sequence, created_at FROM pending_requests
          WHERE id = ${id}`;
        const decoded = yield* decode("resolve interaction", Schema.Array(InteractionRow), rows);
        const row = decoded[0];
        if (row === undefined) {
          return yield* Effect.fail(storeError("resolve interaction", "Interaction not found"));
        }
        const interaction = yield* interactionFromRow(row);
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "interaction.upserted",
          interaction: {
            id: interaction.id,
            projectId: interaction.projectId,
            threadId: interaction.threadId,
            turnId: interaction.turnId,
            nodeId: interaction.nodeId,
            kind: interaction.kind,
            title: interaction.title,
            description: interaction.description,
            options: interaction.options,
            status: interaction.status,
            createdAt: interaction.createdAt,
          },
        });
        return { record: interaction, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("resolve interaction", cause)),
      ),
    admitInteractionResponse: (input) =>
      Effect.gen(function* () {
        const receipt = yield* findReceipt(input.commandId);
        if (receipt !== null) {
          const replayedId = yield* decode(
            "replayed interaction response",
            PendingInteractionId,
            receipt.aggregateId,
          );
          const replayed = yield* findInteractionById(replayedId);
          if (replayed === null) {
            return yield* Effect.fail(
              storeError("admit interaction response", "Accepted response has no interaction"),
            );
          }
          return { acceptedNow: false, interaction: replayed, eventSequence: null } as const;
        }
        const interaction = yield* findInteractionById(input.interactionId);
        if (interaction === null) {
          return yield* Effect.fail(
            storeError("admit interaction response", "Interaction not found"),
          );
        }
        if (interaction.status !== "pending") {
          return yield* Effect.fail(
            storeError(
              "admit interaction response",
              "Interaction is no longer pending",
              "conflict",
            ),
          );
        }
        const intentId = `interaction:${interaction.id}`;
        const liveIntents = yield* sql<{ readonly id: string }>`SELECT id FROM side_effect_intents
          WHERE id = ${intentId} AND kind = 'acp.interaction-response'
            AND state IN ('pending', 'running')`;
        if (liveIntents.length > 0) {
          return yield* Effect.fail(
            storeError(
              "admit interaction response",
              "Interaction response is already dispatching",
              "conflict",
            ),
          );
        }
        const dispatching = { ...interaction, status: "dispatching" as const };
        const eventSequence = yield* appendEvent({
          origin: "client",
          type: "interaction.upserted",
          interaction: {
            id: dispatching.id,
            projectId: dispatching.projectId,
            threadId: dispatching.threadId,
            turnId: dispatching.turnId,
            nodeId: dispatching.nodeId,
            kind: dispatching.kind,
            title: dispatching.title,
            description: dispatching.description,
            options: dispatching.options,
            status: dispatching.status,
            createdAt: dispatching.createdAt,
          },
        });
        yield* sql`UPDATE pending_requests SET status = 'dispatching', sequence = ${eventSequence}
          WHERE id = ${interaction.id} AND status = 'pending'`;
        yield* sql`INSERT INTO side_effect_intents
          (id, command_id, kind, state, phase, lease_id, payload_json, created_at, updated_at)
          VALUES (${intentId}, ${input.commandId}, 'acp.interaction-response', 'running',
            'dispatching-provider', ${input.leaseId},
            ${JSON.stringify({
              interactionId: interaction.id,
              threadId: interaction.threadId,
              turnId: interaction.turnId,
              optionId: input.optionId,
            })}, ${input.createdAt}, ${input.createdAt})`;
        yield* saveReceipt({
          commandId: input.commandId,
          status: "accepted",
          aggregateId: interaction.id,
          reason: null,
          createdAt: input.createdAt,
        });
        return {
          acceptedNow: true,
          interaction: { ...dispatching, sequence: eventSequence },
          eventSequence,
          leaseId: input.leaseId,
        } as const;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("admit interaction response", cause)),
      ),
    settleInteractionResponse: (
      interactionId,
      leaseId,
      status,
      intentState,
      updatedAt,
      failureReason,
    ) =>
      Effect.gen(function* () {
        const interaction = yield* findInteractionById(interactionId);
        if (interaction === null) {
          return yield* Effect.fail(
            storeError("settle interaction response", "Interaction not found"),
          );
        }
        if (interaction.status !== "dispatching") {
          return yield* Effect.fail(
            storeError(
              "settle interaction response",
              "Interaction is no longer dispatching",
              "conflict",
            ),
          );
        }
        const settledIntent = yield* sql<{ readonly id: string }>`UPDATE side_effect_intents
          SET state = ${intentState}, phase = 'completed', failure_reason = ${failureReason ?? null},
            lease_id = NULL, lease_expires_at = NULL, updated_at = ${updatedAt}
          WHERE id = ${`interaction:${interactionId}`} AND kind = 'acp.interaction-response'
            AND state = 'running' AND lease_id = ${leaseId}
          RETURNING id`;
        if (settledIntent.length !== 1) {
          return yield* Effect.fail(
            storeError(
              "settle interaction response",
              "Interaction response lease was lost",
              "conflict",
            ),
          );
        }
        const settled = { ...interaction, status };
        const eventSequence = yield* appendEvent({
          origin: "server",
          type: "interaction.upserted",
          interaction: {
            id: settled.id,
            projectId: settled.projectId,
            threadId: settled.threadId,
            turnId: settled.turnId,
            nodeId: settled.nodeId,
            kind: settled.kind,
            title: settled.title,
            description: settled.description,
            options: settled.options,
            status: settled.status,
            createdAt: settled.createdAt,
          },
        });
        yield* sql`UPDATE pending_requests SET status = ${status}, sequence = ${eventSequence}
          WHERE id = ${interactionId} AND status = 'dispatching'`;
        return { record: { ...settled, sequence: eventSequence }, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("settle interaction response", cause)),
      ),
    upsertAgentNode: (input) =>
      Effect.gen(function* () {
        const eventSequence = yield* appendEvent({
          origin: "provider",
          type: "agent-node.upserted",
          node: input,
        });
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
        return { record: input, eventSequence };
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("upsert agent node", cause)),
      ),
    readEvents,
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
      Effect.gen(function* () {
        yield* appendEvent({ origin: "client", type: "settings.saved", settings });
        yield* sql`INSERT INTO settings (key, schema_version, value_json, updated_at)
          VALUES ('user', 1, ${JSON.stringify(settings)}, ${new Date().toISOString()})
          ON CONFLICT(key) DO UPDATE SET schema_version = excluded.schema_version,
            value_json = excluded.value_json, updated_at = excluded.updated_at`;
        return settings;
      }).pipe(
        sql.withTransaction,
        Effect.mapError((cause) => storeError("save settings", cause)),
      ),
    saveCheckpoint: (record) =>
      Effect.gen(function* () {
        yield* appendEvent({ origin: "git", type: "checkpoint.saved", record });
        yield* sql`INSERT INTO checkpoints (id, thread_id, turn_id, kind, ref, created_at, checkpoint_json)
          VALUES (${record.checkpoint.id}, ${record.threadId}, ${record.turnId}, ${record.kind},
            ${record.checkpoint.snapshotPath}, ${record.checkpoint.createdAt},
            ${JSON.stringify(record.checkpoint)})
          ON CONFLICT(id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json`;
        return record;
      }).pipe(
        sql.withTransaction,
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

export class DatabaseRuntime extends Context.Service<DatabaseRuntime, MetaClankerStore>()(
  "@metaclanker/persistence/DatabaseRuntime",
) {}

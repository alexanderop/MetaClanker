import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import {
  adapterEntry,
  makeAcpSessions,
  type AdapterCommand,
} from "@metaclanker/acp-client/session";
import { Store } from "@metaclanker/application/commands";
import type {
  AcpSessionHandle,
  MetaClankerStore,
  NormalizedAgentEvent,
  TurnCompletionStatus,
} from "@metaclanker/application/ports";
import { AgentNodeId, MessageId, ThreadId, ToolCallId, TurnId } from "@metaclanker/contracts/ids";
import type { CommandId, PendingInteractionId, ProjectId } from "@metaclanker/contracts/ids";
import type {
  AgentNode,
  Message,
  PendingInteraction,
  Project,
  Provider,
  Thread,
  ThreadDetail,
  ThreadStatus,
  ToolCall,
} from "@metaclanker/contracts/wire";
import { CheckpointsService } from "@metaclanker/git/checkpoints";

import { publishThreadEvent } from "./hub.js";
import { runApplication } from "./runtime.js";
import { deriveThreadTitle } from "./thread-title.js";

const unavailableProviders = new Set<Provider>();
const unavailableAdapter = (provider: Provider): AdapterCommand => {
  unavailableProviders.add(provider);
  return { command: process.execPath, args: ["--eval", "process.exit(1)"] };
};
const installedAdapter = (provider: Provider): AdapterCommand => {
  try {
    return { command: process.execPath, args: [adapterEntry(provider)] };
  } catch {
    return unavailableAdapter(provider);
  }
};
const adapterCommands = (): Readonly<Record<Provider, AdapterCommand>> => {
  const fakeEntry = process.env["METACLANKER_FAKE_ACP_ENTRY"];
  if (fakeEntry !== undefined) {
    const entry = fakeEntry.startsWith("file:") ? fileURLToPath(fakeEntry) : fakeEntry;
    const command = { command: process.execPath, args: [entry] };
    return { codex: command, claude: command };
  }
  return { codex: installedAdapter("codex"), claude: installedAdapter("claude") };
};

const activeSessions = new Map<string, AcpSessionHandle>();
const activeTurns = new Set<string>();
const backgroundTasks = new Set<Promise<void>>();

export const listProviderReadiness = (): ReadonlyArray<{
  provider: Provider;
  status: "ready" | "unavailable";
  reason: string | null;
}> =>
  (["codex", "claude"] as const).map((provider) => ({
    provider,
    status: unavailableProviders.has(provider) ? "unavailable" : "ready",
    reason: unavailableProviders.has(provider) ? "The local ACP adapter is not installed" : null,
  }));

const withStore = <A>(use: (store: MetaClankerStore) => Effect.Effect<A, unknown>) =>
  runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* use(store);
    }),
  );

const threadDetail = (id: ThreadId): Promise<ThreadDetail | null> =>
  withStore((store) => store.getThread(id));

const shellProjects = (): Promise<ReadonlyArray<Project>> =>
  withStore((store) => store.shellSnapshot.pipe(Effect.map((snapshot) => snapshot.projects)));

const publishStatus = async (threadId: ThreadId, status: ThreadStatus): Promise<void> => {
  const sequence = await withStore((store) => store.setThreadStatus(threadId, status));
  publishThreadEvent(threadId, { type: "thread-status", sequence, threadId, status });
};

const persistMessage = async (input: Omit<Message, "sequence">): Promise<Message> => {
  const message = await withStore((store) => store.appendMessage(input));
  publishThreadEvent(message.threadId, {
    type: "message-upserted",
    sequence: message.sequence,
    message,
  });
  return message;
};

const latestSequence = async (threadId: ThreadId): Promise<number> => {
  const detail = await threadDetail(threadId);
  return detail?.latestSequence ?? 0;
};

const persistToolCall = async (toolCall: ToolCall): Promise<void> => {
  await withStore((store) => store.upsertToolCall(toolCall));
  publishThreadEvent(toolCall.threadId, {
    type: "tool-upserted",
    sequence: await latestSequence(toolCall.threadId),
    toolCall,
  });
};

const persistInteraction = async (interaction: PendingInteraction): Promise<void> => {
  await withStore((store) => store.upsertInteraction(interaction));
  publishThreadEvent(interaction.threadId, {
    type: "interaction-upserted",
    sequence: await latestSequence(interaction.threadId),
    interaction,
  });
};

const persistNode = async (node: AgentNode): Promise<void> => {
  await withStore((store) => store.upsertAgentNode(node));
  publishThreadEvent(node.threadId, {
    type: "agent-node-upserted",
    sequence: await latestSequence(node.threadId),
    node,
  });
};

const openThreadSession = async (
  detail: ThreadDetail,
  project: Project,
  options: Pick<TurnContext, "effort" | "permissionMode">,
): Promise<AcpSessionHandle> => {
  const current = activeSessions.get(detail.thread.id);
  if (current !== undefined) return current;
  const handle = await Effect.runPromise(
    makeAcpSessions(adapterCommands()).open({
      provider: detail.thread.provider,
      cwd: project.path,
      projectId: project.id,
      threadId: detail.thread.id,
      providerSessionId: detail.thread.providerSessionId,
      model: detail.thread.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
    }),
  );
  if (detail.thread.providerSessionId !== handle.providerSessionId) {
    await withStore((store) =>
      store.setProviderSession(detail.thread.id, handle.providerSessionId),
    );
  }
  activeSessions.set(detail.thread.id, handle);
  return handle;
};

interface TurnContext {
  readonly detail: ThreadDetail;
  readonly project: Project;
  readonly turnId: TurnId;
  readonly agentMessageId: MessageId;
  readonly thoughtMessageId: MessageId;
  readonly planMessageId: MessageId;
  readonly rootNodeId: AgentNodeId;
  readonly startedAt: string;
  readonly effort: string | null;
  readonly permissionMode: string | null;
}

const eventWriter =
  (context: TurnContext) =>
  (event: NormalizedAgentEvent): Effect.Effect<void> =>
    Effect.tryPromise({
      try: async () => {
        if (event.type === "agent-message-chunk") {
          await persistMessage({
            id: context.agentMessageId,
            threadId: context.detail.thread.id,
            turnId: context.turnId,
            role: "agent",
            content: event.chunk,
            createdAt: context.startedAt,
          });
          return;
        }
        if (event.type === "thought-chunk") {
          await persistMessage({
            id: context.thoughtMessageId,
            threadId: context.detail.thread.id,
            turnId: context.turnId,
            role: "thought",
            content: event.chunk,
            createdAt: context.startedAt,
          });
          return;
        }
        if (event.type === "plan") {
          await persistMessage({
            id: context.planMessageId,
            threadId: context.detail.thread.id,
            turnId: context.turnId,
            role: "system",
            content: event.content,
            createdAt: context.startedAt,
          });
          return;
        }
        if (event.type === "tool-call") {
          const now = new Date().toISOString();
          await persistToolCall({
            id: ToolCallId.make(event.toolCallId),
            threadId: context.detail.thread.id,
            turnId: context.turnId,
            nodeId: context.rootNodeId,
            title: event.title,
            kind: event.kind,
            status: event.status,
            content: event.content,
            createdAt: now,
            updatedAt: now,
          });
          return;
        }
        if (event.type === "permission") {
          await persistInteraction(event.interaction);
          await persistNode({
            id: context.rootNodeId,
            threadId: context.detail.thread.id,
            parentId: null,
            name: context.detail.thread.title,
            provider: context.detail.thread.provider,
            model: context.detail.thread.model,
            state: "needs-input",
            activity: event.interaction.title,
            childCount: 0,
            pendingApproval: true,
            changedFileCount: 0,
          });
          return;
        }
        if (event.type === "agent-node") {
          await persistNode(event.node);
          return;
        }
        if (event.type === "runtime-failure") {
          throw new Error(event.message);
        }
      },
      catch: (cause) => cause,
    }).pipe(Effect.catchAll((cause) => Effect.logError("Failed to persist ACP update", cause)));

const executePromptWork = async (
  context: TurnContext,
  text: string,
  attachments: ReadonlyArray<string>,
): Promise<TurnCompletionStatus> => {
  const preTurn = await runApplication(
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointsService;
      return yield* checkpoints.capture(context.project.path);
    }),
  );
  await withStore((store) =>
    store.saveCheckpoint({
      checkpoint: preTurn,
      threadId: context.detail.thread.id,
      turnId: context.turnId,
      kind: "pre-turn",
    }),
  );
  const handle = await openThreadSession(context.detail, context.project, context);
  const outcome = await Effect.runPromise(
    handle.prompt({ turnId: context.turnId, text, attachments }, eventWriter(context)),
  );
  await publishStatus(context.detail.thread.id, outcome.stopReason);
  await persistNode({
    id: context.rootNodeId,
    threadId: context.detail.thread.id,
    parentId: null,
    name: context.detail.thread.title,
    provider: context.detail.thread.provider,
    model: context.detail.thread.model,
    state: outcome.stopReason === "completed" ? "completed" : "interrupted",
    activity: outcome.stopReason === "completed" ? "Turn completed" : "Turn interrupted",
    childCount: 0,
    pendingApproval: false,
    changedFileCount: 0,
  });
  const postTurn = await runApplication(
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointsService;
      return yield* checkpoints.capture(context.project.path);
    }),
  );
  await withStore((store) =>
    store.saveCheckpoint({
      checkpoint: postTurn,
      threadId: context.detail.thread.id,
      turnId: context.turnId,
      kind: "post-turn",
    }),
  );
  const workspaceDiff = await runApplication(
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointsService;
      return yield* checkpoints.diff(preTurn, postTurn);
    }),
  );
  await persistNode({
    id: context.rootNodeId,
    threadId: context.detail.thread.id,
    parentId: null,
    name: context.detail.thread.title,
    provider: context.detail.thread.provider,
    model: context.detail.thread.model,
    state: outcome.stopReason === "completed" ? "completed" : "interrupted",
    activity: outcome.stopReason === "completed" ? "Turn completed" : "Turn interrupted",
    childCount: 0,
    pendingApproval: false,
    changedFileCount: workspaceDiff.files.length,
  });
  return outcome.stopReason;
};

const failureTurnStatus = (cause: unknown): TurnCompletionStatus => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "AcpRuntimeError" &&
    "code" in cause &&
    (cause.code === "disconnected" || cause.code === "process-exit")
  ) {
    return "recovery-required";
  }
  return "failed";
};

const executePrompt = (
  context: TurnContext,
  text: string,
  attachments: ReadonlyArray<string>,
  persistedIntent = false,
): Promise<void> =>
  executePromptWork(context, text, attachments)
    .then(async (status) => {
      if (persistedIntent) {
        await withStore((store) =>
          store.completeTurn(context.turnId, status, new Date().toISOString()),
        );
      }
    })
    .catch(async (cause: unknown) => {
      const status = failureTurnStatus(cause);
      await publishStatus(context.detail.thread.id, status);
      if (persistedIntent) {
        await withStore((store) =>
          store.completeTurn(context.turnId, status, new Date().toISOString()),
        );
      }
      await persistMessage({
        id: MessageId.make(crypto.randomUUID()),
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        role: "system",
        content: "The agent connection failed. This turn was preserved and was not sent again.",
        createdAt: new Date().toISOString(),
      });
    })
    .finally(() => activeTurns.delete(context.detail.thread.id));

export const dispatchPrompt = async (
  commandId: CommandId,
  threadId: ThreadId,
  text: string,
  attachments: ReadonlyArray<string>,
): Promise<TurnId> => {
  const existingReceipt = await withStore((store) => store.findReceipt(commandId));
  if (existingReceipt !== null) return TurnId.make(existingReceipt.aggregateId);
  if (activeTurns.has(threadId)) throw new Error("This thread already has an active turn");
  const detail = await threadDetail(threadId);
  if (detail === null) throw new Error("Thread not found");
  const projects = await shellProjects();
  if (unavailableProviders.has(detail.thread.provider)) {
    throw new Error(`The ${detail.thread.provider} provider is unavailable`);
  }
  const project = projects.find((candidate) => candidate.id === detail.thread.projectId);
  if (project === undefined) throw new Error("Owning project not found");

  const turnId = TurnId.make(crypto.randomUUID());
  const startedAt = new Date().toISOString();
  const rootNodeId = AgentNodeId.make(`root:${threadId}`);
  activeTurns.add(threadId);
  await persistMessage({
    id: MessageId.make(crypto.randomUUID()),
    threadId,
    turnId,
    role: "user",
    content: text,
    createdAt: startedAt,
  });
  await publishStatus(threadId, "running");
  await persistNode({
    id: rootNodeId,
    threadId,
    parentId: null,
    name: detail.thread.title,
    provider: detail.thread.provider,
    model: detail.thread.model,
    state: "running",
    activity: "Starting turn",
    childCount: 0,
    pendingApproval: false,
    changedFileCount: 0,
  });
  await withStore((store) =>
    store.saveReceipt({
      commandId,
      status: "accepted",
      aggregateId: turnId,
      reason: null,
      createdAt: startedAt,
    }),
  );
  const task = executePrompt(
    {
      detail,
      project,
      turnId,
      agentMessageId: MessageId.make(crypto.randomUUID()),
      thoughtMessageId: MessageId.make(crypto.randomUUID()),
      planMessageId: MessageId.make(crypto.randomUUID()),
      rootNodeId,
      startedAt,
      effort: null,
      permissionMode: null,
    },
    text,
    attachments,
  );
  const tracked = task.finally(() => backgroundTasks.delete(tracked));
  backgroundTasks.add(tracked);
  return turnId;
};

export interface StartThreadWithPromptInput {
  readonly commandId: CommandId;
  readonly projectId: ProjectId;
  readonly provider: Provider;
  readonly model: string | null;
  readonly effort: string | null;
  readonly permissionMode: string | null;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<string>;
}

export interface StartThreadWithPromptResult {
  readonly accepted: true;
  readonly thread: Thread;
  readonly turnId: TurnId;
}

export const startThreadWithPrompt = async (
  input: StartThreadWithPromptInput,
): Promise<StartThreadWithPromptResult> => {
  if (unavailableProviders.has(input.provider)) {
    throw new Error(`The ${input.provider} provider is unavailable`);
  }
  const projects = await shellProjects();
  const project = projects.find((candidate) => candidate.id === input.projectId);
  if (project === undefined) throw new Error("Project not found");

  const threadId = ThreadId.make(crypto.randomUUID());
  const turnId = TurnId.make(crypto.randomUUID());
  const startedAt = new Date().toISOString();
  const started = await withStore((store) =>
    store.startThread({
      id: threadId,
      turnId,
      userMessageId: MessageId.make(crypto.randomUUID()),
      commandId: input.commandId,
      projectId: input.projectId,
      provider: input.provider,
      title: deriveThreadTitle(input.prompt, input.attachments),
      model: input.model,
      prompt: input.prompt,
      attachments: input.attachments,
      createdAt: startedAt,
    }),
  );

  if (!started.acceptedNow) {
    return { accepted: true, thread: started.thread, turnId: started.turnId };
  }

  const detail = await threadDetail(started.thread.id);
  if (detail === null) throw new Error("Accepted thread could not be loaded");
  const rootNodeId = AgentNodeId.make(`root:${started.thread.id}`);
  activeTurns.add(started.thread.id);
  const task = persistNode({
    id: rootNodeId,
    threadId: started.thread.id,
    parentId: null,
    name: started.thread.title,
    provider: started.thread.provider,
    model: started.thread.model,
    state: "running",
    activity: "Starting turn",
    childCount: 0,
    pendingApproval: false,
    changedFileCount: 0,
  })
    .then(() =>
      executePrompt(
        {
          detail,
          project,
          turnId: started.turnId,
          agentMessageId: MessageId.make(crypto.randomUUID()),
          thoughtMessageId: MessageId.make(crypto.randomUUID()),
          planMessageId: MessageId.make(crypto.randomUUID()),
          rootNodeId,
          startedAt,
          effort: input.effort,
          permissionMode: input.permissionMode,
        },
        input.prompt,
        input.attachments,
        true,
      ),
    )
    .catch(async (cause: unknown) => {
      const status = failureTurnStatus(cause);
      await publishStatus(started.thread.id, status);
      await withStore((store) =>
        store.completeTurn(started.turnId, status, new Date().toISOString()),
      );
      await persistMessage({
        id: MessageId.make(crypto.randomUUID()),
        threadId: started.thread.id,
        turnId: started.turnId,
        role: "system",
        content: "The agent connection failed. This turn was preserved and was not sent again.",
        createdAt: new Date().toISOString(),
      });
    })
    .finally(() => activeTurns.delete(started.thread.id));
  const tracked = task.finally(() => backgroundTasks.delete(tracked));
  backgroundTasks.add(tracked);

  return { accepted: true, thread: started.thread, turnId: started.turnId };
};

export const cancelPrompt = async (threadId: ThreadId): Promise<void> => {
  const session = activeSessions.get(threadId);
  if (session === undefined || !activeTurns.has(threadId)) throw new Error("No active turn");
  await publishStatus(threadId, "cancelling");
  await Effect.runPromise(session.requestCancel());
};

export const respondToInteraction = async (
  commandId: CommandId,
  interactionId: PendingInteractionId,
  optionId: string,
): Promise<PendingInteraction> => {
  const receipt = await withStore((store) => store.findReceipt(commandId));
  const shell = await withStore((store) => store.shellSnapshot);
  const details = await Promise.all(shell.threads.map((thread) => threadDetail(thread.id)));
  const owner = details.find((detail) =>
    detail?.interactions.some((candidate) => candidate.id === interactionId),
  );
  const interaction = owner?.interactions.find((candidate) => candidate.id === interactionId);
  if (owner === null || owner === undefined || interaction === undefined) {
    throw new Error("Interaction not found");
  }
  if (receipt !== null) return interaction;
  const session = activeSessions.get(owner.thread.id);
  if (session === undefined) {
    const stale = await withStore((store) => store.resolveInteraction(interactionId, "stale"));
    await persistInteraction(stale);
    await withStore((store) =>
      store.saveReceipt({
        commandId,
        status: "accepted",
        aggregateId: interactionId,
        reason: null,
        createdAt: new Date().toISOString(),
      }),
    );
    return stale;
  }
  await Effect.runPromise(session.respondInteraction(interactionId, optionId));
  const resolved = await withStore((store) => store.resolveInteraction(interactionId, "resolved"));
  await persistInteraction(resolved);
  await withStore((store) =>
    store.saveReceipt({
      commandId,
      status: "accepted",
      aggregateId: interactionId,
      reason: null,
      createdAt: new Date().toISOString(),
    }),
  );
  return resolved;
};

export const closeAgentSessions = async (): Promise<void> => {
  await Promise.all(
    [...activeSessions.values()].map((session) => Effect.runPromise(session.close)),
  );
  activeSessions.clear();
  await Promise.all(backgroundTasks);
};

/** Waits for durable follow-up work without using elapsed time as a test signal. */
export const drainAgentWork = async (): Promise<void> => {
  await Promise.all(backgroundTasks);
};

export const reviewThread = async (threadId: ThreadId) => {
  const records = await withStore((store) => store.listCheckpoints(threadId));
  const post = records.toReversed().find((record) => record.kind === "post-turn");
  const pre = records
    .toReversed()
    .find((record) => record.kind === "pre-turn" && record.turnId === post?.turnId);
  if (pre === undefined || post === undefined) {
    return { checkpoints: records, diff: { files: [] } };
  }
  const diff = await runApplication(
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointsService;
      return yield* checkpoints.diff(pre.checkpoint, post.checkpoint);
    }),
  );
  return { checkpoints: records, diff };
};

export const previewFileRestore = async (threadId: ThreadId, checkpointId: string) => {
  const records = await withStore((store) => store.listCheckpoints(threadId));
  const record = records.find((candidate) => candidate.checkpoint.id === checkpointId);
  if (record === undefined) throw new Error("Checkpoint not found");
  return runApplication(
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointsService;
      return yield* checkpoints.previewRestore(record.checkpoint);
    }),
  );
};

export const restoreThreadFiles = async (threadId: ThreadId, checkpointId: string) => {
  const detail = await threadDetail(threadId);
  if (detail === null) throw new Error("Thread not found");
  if (activeTurns.has(threadId))
    throw new Error("Files can be restored only while the session is idle");
  const records = await withStore((store) => store.listCheckpoints(threadId));
  const record = records.find((candidate) => candidate.checkpoint.id === checkpointId);
  if (record === undefined) throw new Error("Checkpoint not found");
  const undo = await runApplication(
    Effect.gen(function* () {
      const checkpoints = yield* CheckpointsService;
      return yield* checkpoints.restore(record.checkpoint);
    }),
  );
  const persisted = await withStore((store) =>
    store.saveCheckpoint({
      checkpoint: undo,
      threadId,
      turnId: record.turnId,
      kind: "undo",
    }),
  );
  await persistMessage({
    id: MessageId.make(crypto.randomUUID()),
    threadId,
    turnId: record.turnId,
    role: "system",
    content:
      "Files were restored to the selected checkpoint. The provider conversation was not rewound; continue in a new session if the restored state changes the task context.",
    createdAt: new Date().toISOString(),
  });
  return persisted;
};

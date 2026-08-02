import { Effect } from "effect";

import { makeAcpSessions } from "@metaclanker/acp-client/session";
import { ApplicationError, mapStoreError, Store } from "@metaclanker/application/commands";
import type {
  AcpSessionHandle,
  MetaClankerStore,
  NormalizedAgentEvent,
  StoreError,
  TurnCompletionStatus,
  UpsertToolCallRecord,
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
} from "@metaclanker/contracts/wire";
import { CheckpointsService } from "@metaclanker/git/checkpoints";

import { publishShellEvent, publishThreadEvent } from "./hub.js";
import { LocalDiagnostics } from "./local-diagnostics.js";
import { applicationProviderAdapters, runApplication } from "./runtime.js";
import { deriveThreadTitle } from "./thread-title.js";
import { TurnSupervisor } from "./turn-supervisor.js";

const submitAgentWork = (
  correlation: TurnContext,
  work: Effect.Effect<void, unknown>,
): Promise<void> =>
  runApplication(
    Effect.gen(function* () {
      const supervisor = yield* TurnSupervisor;
      const diagnostics = yield* LocalDiagnostics;
      const submittedAt = Date.now();
      yield* supervisor.submit(
        correlation.detail.thread.id,
        Effect.gen(function* () {
          const startedAt = Date.now();
          yield* diagnostics.record({
            operation: "agent.prompt",
            phase: "started",
            queueLagMs: startedAt - submittedAt,
            provider: correlation.detail.thread.provider,
            projectId: correlation.project.id,
            threadId: correlation.detail.thread.id,
            turnId: correlation.turnId,
          });
          yield* work;
          yield* diagnostics.record({
            operation: "agent.prompt",
            phase: "completed",
            outcome: "ok",
            durationMs: Date.now() - startedAt,
            provider: correlation.detail.thread.provider,
            projectId: correlation.project.id,
            threadId: correlation.detail.thread.id,
            turnId: correlation.turnId,
          });
        }).pipe(
          Effect.catch((cause) =>
            Effect.tryPromise({
              try: () => recordPromptFailure(correlation, cause),
              catch: (error) => error,
            }).pipe(
              Effect.catch(() => Effect.void),
              Effect.asVoid,
            ),
          ),
        ),
      );
    }),
  );

export const listProviderReadiness = async (): Promise<
  ReadonlyArray<{
    provider: Provider;
    status: "ready" | "unavailable";
    reason: string | null;
  }>
> => {
  const { readiness } = await applicationProviderAdapters();
  return (["codex", "claude"] as const).map((provider) => ({
    provider,
    status: readiness[provider] ? "ready" : "unavailable",
    reason: readiness[provider] ? null : "The local ACP adapter is not installed",
  }));
};

const applicationError = (code: ApplicationError["code"], message: string): ApplicationError =>
  new ApplicationError({ code, message });

const withStore = <A>(use: (store: MetaClankerStore) => Effect.Effect<A, StoreError>) =>
  runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* mapStoreError(use(store));
    }),
  );

const threadDetail = (id: ThreadId): Promise<ThreadDetail | null> =>
  withStore((store) => store.getThread(id));

const shellProjects = (): Promise<ReadonlyArray<Project>> =>
  withStore((store) => store.shellSnapshot.pipe(Effect.map((snapshot) => snapshot.projects)));

const publishStatus = async (threadId: ThreadId, status: ThreadStatus): Promise<void> => {
  const sequence = await withStore((store) => store.setThreadStatus(threadId, status));
  const event = { type: "thread-status", sequence, threadId, status } as const;
  await publishThreadEvent(threadId, event);
  await publishShellEvent(event);
};

const persistMessage = async (input: Omit<Message, "sequence">): Promise<Message> => {
  const persisted = await withStore((store) => store.appendMessage(input));
  const message = persisted.record;
  await publishThreadEvent(message.threadId, {
    type: "message-upserted",
    sequence: persisted.eventSequence,
    message,
  });
  return message;
};

const persistToolCall = async (input: UpsertToolCallRecord): Promise<void> => {
  const persisted = await withStore((store) => store.upsertToolCall(input));
  const toolCall = persisted.record;
  await publishThreadEvent(toolCall.threadId, {
    type: "tool-upserted",
    sequence: persisted.eventSequence,
    toolCall,
  });
};

const persistInteraction = async (
  input: Omit<PendingInteraction, "sequence">,
): Promise<PendingInteraction> => {
  const persisted = await withStore((store) => store.upsertInteraction(input));
  const interaction = persisted.record;
  await publishThreadEvent(interaction.threadId, {
    type: "interaction-upserted",
    sequence: persisted.eventSequence,
    interaction,
  });
  return interaction;
};

const persistNode = async (node: AgentNode): Promise<void> => {
  const persisted = await withStore((store) => store.upsertAgentNode(node));
  await publishThreadEvent(node.threadId, {
    type: "agent-node-upserted",
    sequence: persisted.eventSequence,
    node,
  });
};

const openThreadSession = async (
  detail: ThreadDetail,
  project: Project,
  options: Pick<TurnContext, "effort" | "permissionMode">,
): Promise<AcpSessionHandle> => {
  const supervisor = await runApplication(Effect.service(TurnSupervisor));
  const current = supervisor.session(detail.thread.id);
  if (current !== undefined) return current;
  const opening = supervisor.opening(detail.thread.id);
  if (opening !== undefined) return opening;
  const created = (async (): Promise<AcpSessionHandle> => {
    const { commands } = await applicationProviderAdapters();
    const handle = await runApplication(
      makeAcpSessions(commands).open({
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
    try {
      if (detail.thread.providerSessionId !== handle.providerSessionId) {
        await withStore((store) =>
          store.setProviderSession(detail.thread.id, handle.providerSessionId),
        );
      }
      if (!supervisor.registerSession(detail.thread.id, handle)) {
        await runApplication(handle.close);
        throw applicationError("conflict", "The server runtime is shutting down");
      }
      return handle;
    } catch (cause) {
      await runApplication(handle.close);
      throw cause;
    }
  })();
  if (!supervisor.registerOpening(detail.thread.id, created)) {
    await created.catch(() => undefined);
    throw applicationError("conflict", "The server runtime is shutting down");
  }
  try {
    return await created;
  } finally {
    supervisor.clearOpening(detail.thread.id, created);
  }
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
  readonly leaseId: string;
  readonly dispatchStarted: { value: boolean };
  readonly finishTurn: () => void;
}

const eventWriter =
  (context: TurnContext) =>
  (event: NormalizedAgentEvent): Effect.Effect<void> => {
    if (event.type === "runtime-failure") {
      // Provider envelopes can contain prompts and absolute paths; never log or expose them.
      return Effect.logWarning("Agent session reported a runtime failure");
    }
    return Effect.tryPromise({
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
      },
      catch: (cause) => cause,
    }).pipe(Effect.catch(() => Effect.logError("Failed to persist an ACP update")));
  };

const executePromptWork = (
  context: TurnContext,
  text: string,
  attachments: ReadonlyArray<string>,
): Effect.Effect<TurnCompletionStatus, unknown> =>
  Effect.gen(function* () {
    const claimed = yield* Effect.tryPromise({
      try: () =>
        withStore((store) =>
          store.claimPromptIntent(
            context.turnId,
            context.leaseId,
            new Date(Date.now() + 5 * 60_000).toISOString(),
          ),
        ),
      catch: (cause) => cause,
    });
    if (claimed === null) {
      return yield* Effect.fail(
        applicationError("conflict", "Prompt work is no longer eligible to run"),
      );
    }
    const preTurn = yield* Effect.tryPromise({
      try: () =>
        runApplication(
          Effect.gen(function* () {
            const checkpoints = yield* CheckpointsService;
            return yield* checkpoints.capture(context.project.path);
          }),
        ),
      catch: (cause) => cause,
    });
    yield* Effect.tryPromise({
      try: () =>
        withStore((store) =>
          store.saveCheckpoint({
            checkpoint: preTurn,
            threadId: context.detail.thread.id,
            turnId: context.turnId,
            kind: "pre-turn",
          }),
        ),
      catch: (cause) => cause,
    });
    const handle = yield* Effect.tryPromise({
      try: () =>
        withStore((store) =>
          store.transitionPromptIntent(
            context.turnId,
            context.leaseId,
            "opening-session",
            new Date().toISOString(),
          ),
        ),
      catch: (cause) => cause,
    });
    if (!handle) {
      return yield* Effect.fail(applicationError("conflict", "Prompt work lease was lost"));
    }
    const session = yield* Effect.tryPromise({
      try: () => openThreadSession(context.detail, context.project, context),
      catch: (cause) => cause,
    });
    const dispatching = yield* Effect.tryPromise({
      try: () =>
        withStore((store) =>
          store.transitionPromptIntent(
            context.turnId,
            context.leaseId,
            "dispatching-provider",
            new Date().toISOString(),
          ),
        ),
      catch: (cause) => cause,
    });
    if (!dispatching) {
      return yield* Effect.fail(applicationError("conflict", "Prompt work lease was lost"));
    }
    context.dispatchStarted.value = true;
    const outcome = yield* session.prompt({ turnId: context.turnId, text, attachments }, (event) =>
      runApplication(eventWriter(context)(event)),
    );
    yield* Effect.tryPromise({
      try: () => publishStatus(context.detail.thread.id, outcome.stopReason),
      catch: (cause) => cause,
    });
    const persistCompletedNode = (changedFileCount: number) =>
      Effect.tryPromise({
        try: () =>
          persistNode({
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
            changedFileCount,
          }),
        catch: (cause) => cause,
      });
    yield* persistCompletedNode(0);
    const postTurn = yield* Effect.tryPromise({
      try: () =>
        runApplication(
          Effect.gen(function* () {
            const checkpoints = yield* CheckpointsService;
            return yield* checkpoints.capture(context.project.path);
          }),
        ),
      catch: (cause) => cause,
    });
    yield* Effect.tryPromise({
      try: () =>
        withStore((store) =>
          store.saveCheckpoint({
            checkpoint: postTurn,
            threadId: context.detail.thread.id,
            turnId: context.turnId,
            kind: "post-turn",
          }),
        ),
      catch: (cause) => cause,
    });
    const workspaceDiff = yield* Effect.tryPromise({
      try: () =>
        runApplication(
          Effect.gen(function* () {
            const checkpoints = yield* CheckpointsService;
            return yield* checkpoints.diff(preTurn, postTurn);
          }),
        ),
      catch: (cause) => cause,
    });
    yield* persistCompletedNode(workspaceDiff.files.length);
    return outcome.stopReason;
  });

const isConnectionFailure = (cause: unknown): boolean =>
  Boolean(
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "AcpRuntimeError" &&
    "code" in cause &&
    (cause.code === "disconnected" || cause.code === "process-exit"),
  );

const failureTurnStatus = (cause: unknown): TurnCompletionStatus =>
  isConnectionFailure(cause) ? "recovery-required" : "failed";

const evictThreadSession = async (threadId: ThreadId): Promise<void> => {
  const supervisor = await runApplication(Effect.service(TurnSupervisor));
  const handle = supervisor.takeSession(threadId);
  if (handle === undefined) return;
  await runApplication(handle.close);
};

const recordPromptFailure = async (context: TurnContext, cause: unknown): Promise<void> => {
  const status = context.dispatchStarted.value ? "recovery-required" : failureTurnStatus(cause);
  if (isConnectionFailure(cause)) await evictThreadSession(context.detail.thread.id);
  await publishStatus(context.detail.thread.id, status);
  await withStore((store) => store.completeTurn(context.turnId, status, new Date().toISOString()));
  await persistMessage({
    id: MessageId.make(crypto.randomUUID()),
    threadId: context.detail.thread.id,
    turnId: context.turnId,
    role: "system",
    content: "The agent connection failed. This turn was preserved and was not sent again.",
    createdAt: new Date().toISOString(),
  });
  context.finishTurn();
};

const executePrompt = (
  context: TurnContext,
  text: string,
  attachments: ReadonlyArray<string>,
): Effect.Effect<void, unknown> =>
  executePromptWork(context, text, attachments).pipe(
    Effect.tap((status) =>
      Effect.tryPromise({
        try: () =>
          withStore((store) =>
            store.completeTurn(context.turnId, status, new Date().toISOString()),
          ),
        catch: (cause) => cause,
      }),
    ),
    Effect.ensuring(Effect.sync(context.finishTurn)),
    Effect.asVoid,
  );

export const dispatchPrompt = async (
  commandId: CommandId,
  threadId: ThreadId,
  text: string,
  attachments: ReadonlyArray<string>,
): Promise<TurnId> => {
  const detail = await threadDetail(threadId);
  if (detail === null) throw applicationError("not-found", "Thread not found");
  const projects = await shellProjects();
  if (!(await applicationProviderAdapters()).readiness[detail.thread.provider]) {
    throw applicationError(
      "provider-unavailable",
      `The ${detail.thread.provider} provider is unavailable`,
    );
  }
  const project = projects.find((candidate) => candidate.id === detail.thread.projectId);
  if (project === undefined) throw applicationError("not-found", "Owning project not found");
  const providerDefaults = (await withStore((store) => store.getSettings)).providerDefaults[
    detail.thread.provider
  ];

  const turnId = TurnId.make(crypto.randomUUID());
  const startedAt = new Date().toISOString();
  const rootNodeId = AgentNodeId.make(`root:${threadId}`);
  const rootNode: AgentNode = {
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
  };
  const started = await withStore((store) =>
    store.startTurn({
      commandId,
      threadId,
      turnId,
      userMessageId: MessageId.make(crypto.randomUUID()),
      prompt: text,
      attachments,
      rootNode,
      createdAt: startedAt,
    }),
  );
  if (!started.acceptedNow) return started.turnId;

  const supervisor = await runApplication(Effect.service(TurnSupervisor));
  supervisor.startTurn(threadId);
  const statusEvent = {
    type: "thread-status",
    sequence: started.statusEventSequence,
    threadId,
    status: "running",
  } as const;
  await publishThreadEvent(threadId, statusEvent);
  await publishShellEvent(statusEvent);
  await publishThreadEvent(threadId, {
    type: "message-upserted",
    sequence: started.messageEventSequence,
    message: started.userMessage,
  });
  await publishThreadEvent(threadId, {
    type: "agent-node-upserted",
    sequence: started.nodeEventSequence,
    node: started.rootNode,
  });
  const context: TurnContext = {
    detail: { ...detail, thread: started.thread },
    project,
    turnId: started.turnId,
    agentMessageId: MessageId.make(crypto.randomUUID()),
    thoughtMessageId: MessageId.make(crypto.randomUUID()),
    planMessageId: MessageId.make(crypto.randomUUID()),
    rootNodeId,
    startedAt,
    effort: providerDefaults.effort,
    permissionMode: providerDefaults.permissionMode,
    leaseId: crypto.randomUUID(),
    dispatchStarted: { value: false },
    finishTurn: () => supervisor.finishTurn(threadId),
  };
  await submitAgentWork(context, executePrompt(context, text, attachments));
  return started.turnId;
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
  if (!(await applicationProviderAdapters()).readiness[input.provider]) {
    throw applicationError("provider-unavailable", `The ${input.provider} provider is unavailable`);
  }
  const projects = await shellProjects();
  const project = projects.find((candidate) => candidate.id === input.projectId);
  if (project === undefined) throw applicationError("not-found", "Project not found");

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

  if (started.threadEventSequence !== null) {
    await publishShellEvent({
      type: "thread-upserted",
      sequence: started.threadEventSequence,
      thread: started.thread,
    });
  }

  const detail = await threadDetail(started.thread.id);
  if (detail === null) {
    throw applicationError("persistence", "Accepted thread could not be loaded");
  }
  const rootNodeId = AgentNodeId.make(`root:${started.thread.id}`);
  const supervisor = await runApplication(Effect.service(TurnSupervisor));
  supervisor.startTurn(started.thread.id);
  const context: TurnContext = {
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
    leaseId: crypto.randomUUID(),
    dispatchStarted: { value: false },
    finishTurn: () => supervisor.finishTurn(started.thread.id),
  };
  await submitAgentWork(
    context,
    Effect.tryPromise({
      try: () =>
        persistNode({
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
        }),
      catch: (cause) => cause,
    }).pipe(Effect.andThen(executePrompt(context, input.prompt, input.attachments))),
  );

  return { accepted: true, thread: started.thread, turnId: started.turnId };
};

export const cancelPrompt = async (commandId: CommandId, threadId: ThreadId): Promise<void> => {
  if ((await withStore((store) => store.findReceipt(commandId))) !== null) return;
  const supervisor = await runApplication(Effect.service(TurnSupervisor));
  const session = supervisor.session(threadId);
  if (session === undefined || !supervisor.hasActiveTurn(threadId)) {
    throw applicationError("conflict", "No active turn");
  }
  const admitted = await withStore((store) =>
    store.admitCancel({
      commandId,
      threadId,
      leaseId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }),
  );
  if (!admitted.acceptedNow) return;
  await publishThreadEvent(threadId, {
    type: "thread-status",
    sequence: admitted.eventSequence,
    threadId,
    status: "cancelling",
  });
  await publishShellEvent({
    type: "thread-status",
    sequence: admitted.eventSequence,
    threadId,
    status: "cancelling",
  });
  try {
    await runApplication(session.requestCancel());
    const awaiting = await withStore((store) =>
      store.markCancelAwaiting(admitted.turnId, admitted.leaseId, new Date().toISOString()),
    );
    if (!awaiting) throw applicationError("conflict", "Cancellation work is no longer active");
  } catch (cause) {
    const markedUncertain = await withStore((store) =>
      store.markCancelUncertain(admitted.turnId, admitted.leaseId, new Date().toISOString()),
    );
    if (!markedUncertain) throw applicationError("conflict", "Cancellation work lease was lost");
    await publishStatus(threadId, "recovery-required");
    await withStore((store) =>
      store.completeTurn(admitted.turnId, "recovery-required", new Date().toISOString()),
    );
    throw cause;
  }
};

export const respondToInteraction = async (
  commandId: CommandId,
  interactionId: PendingInteractionId,
  optionId: string,
): Promise<PendingInteraction> => {
  const admitted = await withStore((store) =>
    store.admitInteractionResponse({
      commandId,
      interactionId,
      optionId,
      leaseId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }),
  );
  if (!admitted.acceptedNow) return admitted.interaction;
  await publishThreadEvent(admitted.interaction.threadId, {
    type: "interaction-upserted",
    sequence: admitted.eventSequence,
    interaction: admitted.interaction,
  });
  const session = (await runApplication(Effect.service(TurnSupervisor))).session(
    admitted.interaction.threadId,
  );
  if (session === undefined) {
    const persisted = await withStore((store) =>
      store.settleInteractionResponse(
        interactionId,
        admitted.leaseId,
        "stale",
        "failed",
        new Date().toISOString(),
        "session-unavailable",
      ),
    );
    const stale = persisted.record;
    await publishThreadEvent(stale.threadId, {
      type: "interaction-upserted",
      sequence: persisted.eventSequence,
      interaction: stale,
    });
    return stale;
  }
  try {
    await runApplication(session.respondInteraction(interactionId, optionId));
  } catch (cause) {
    const persisted = await withStore((store) =>
      store.settleInteractionResponse(
        interactionId,
        admitted.leaseId,
        "stale",
        "uncertain",
        new Date().toISOString(),
        "provider-response-uncertain",
      ),
    );
    await publishThreadEvent(persisted.record.threadId, {
      type: "interaction-upserted",
      sequence: persisted.eventSequence,
      interaction: persisted.record,
    });
    throw cause;
  }
  const persisted = await withStore((store) =>
    store.settleInteractionResponse(
      interactionId,
      admitted.leaseId,
      "resolved",
      "succeeded",
      new Date().toISOString(),
    ),
  );
  const resolved = persisted.record;
  await publishThreadEvent(resolved.threadId, {
    type: "interaction-upserted",
    sequence: persisted.eventSequence,
    interaction: resolved,
  });
  return resolved;
};

export const closeAgentSessions = async (): Promise<void> => {
  await runApplication(
    Effect.gen(function* () {
      const supervisor = yield* TurnSupervisor;
      yield* supervisor.closeAll;
    }),
  );
  await drainAgentWork();
};

/** Waits for durable follow-up work without using elapsed time as a test signal. */
export const drainAgentWork = async (): Promise<void> => {
  await runApplication(
    Effect.gen(function* () {
      const supervisor = yield* TurnSupervisor;
      yield* supervisor.drain;
    }),
  );
};

export const restoreThreadFiles = async (
  commandId: CommandId,
  threadId: ThreadId,
  checkpointId: string,
) => {
  const detail = await threadDetail(threadId);
  if (detail === null) throw applicationError("not-found", "Thread not found");
  if ((await runApplication(Effect.service(TurnSupervisor))).hasActiveTurn(threadId))
    throw applicationError("conflict", "Files can be restored only while the session is idle");
  const records = await withStore((store) => store.listCheckpoints(threadId));
  const record = records.find((candidate) => candidate.checkpoint.id === checkpointId);
  if (record === undefined) throw applicationError("not-found", "Checkpoint not found");
  const admitted = await withStore((store) =>
    store.admitRestore({
      commandId,
      threadId,
      checkpointId,
      undoCheckpointId: crypto.randomUUID(),
      leaseId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }),
  );
  if (!admitted.acceptedNow) {
    const undo = records.find((candidate) => candidate.checkpoint.id === admitted.undoCheckpointId);
    if (undo === undefined) {
      throw applicationError("persistence", "Accepted restore has no durable undo checkpoint");
    }
    return undo;
  }
  const markUncertain = async (): Promise<void> => {
    const updatedAt = new Date().toISOString();
    const sequence = await withStore((store) =>
      store.markRestoreUncertain(commandId, admitted.leaseId, threadId, updatedAt),
    );
    if (sequence === null) return;
    const event = {
      type: "thread-status",
      sequence,
      threadId,
      status: "recovery-required",
    } as const;
    await publishThreadEvent(threadId, event);
    await publishShellEvent(event);
  };
  let undo;
  try {
    undo = await runApplication(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.restore(record.checkpoint, admitted.undoCheckpointId);
      }),
    );
  } catch (cause) {
    await markUncertain();
    throw cause;
  }
  let persisted;
  try {
    persisted = await withStore((store) =>
      store.completeRestore(commandId, admitted.leaseId, {
        checkpoint: undo,
        threadId,
        turnId: record.turnId,
        kind: "undo",
      }),
    );
  } catch (cause) {
    await markUncertain();
    throw cause;
  }
  if (persisted === null) {
    throw applicationError("conflict", "Restore work lease was lost");
  }
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

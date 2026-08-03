import * as Effect from "effect/Effect";

import { makeAcpSessions, type AdapterCommand } from "@metaclanker/acp-client/session";
import { ApplicationError, mapStoreError, Store } from "@metaclanker/application/commands";
import type {
  CheckpointError,
  MetaClankerStore,
  NormalizedAgentEvent,
  SessionCapabilities,
  TurnCompletionStatus,
  UpsertToolCallRecord,
} from "@metaclanker/application/ports";
import {
  AgentNodeId,
  CheckpointId,
  MessageId,
  ThreadId,
  ToolCallId,
  TurnId,
} from "@metaclanker/contracts/ids";
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
import { toPersistedCheckpointWire } from "@metaclanker/application/review";

import { LocalDiagnostics } from "./local-diagnostics.js";
import { applicationProviderAdapters, runApplication } from "./runtime.js";
import { deriveThreadTitle } from "./thread-title.js";
import { TurnSupervisor, type SessionFailure } from "./turn-supervisor.js";
import { EventFanout, type EventFanoutService } from "./event-fanout.js";

const applicationError = (code: ApplicationError["code"], message: string): ApplicationError =>
  new ApplicationError({ code, message });

const hasSafeContinuationBoundary = (capabilities: SessionCapabilities): boolean =>
  capabilities.close && (capabilities.resume || capabilities.load);

const continuationIsBlocked = (
  persisted: "safe" | "unsafe" | null,
  remembered: "safe" | "unsafe" | undefined,
  live: SessionCapabilities | undefined,
): boolean => {
  if (persisted === "unsafe" || remembered === "unsafe") return true;
  return live !== undefined && !hasSafeContinuationBoundary(live);
};

export const listProviderReadinessEffect = Effect.fn("AgentCommands.providerReadiness")(function* (
  readiness: Readonly<Record<Provider, boolean>>,
) {
  const store = yield* Store;
  const persistedModels = yield* mapStoreError(store.listProviderModels);
  return (["codex", "claude"] as const).map((provider) => ({
    provider,
    status: readiness[provider] ? ("ready" as const) : ("unavailable" as const),
    reason: readiness[provider] ? null : "The local ACP adapter is not installed",
    models: persistedModels
      .filter((candidate) => candidate.provider === provider)
      .map((candidate) => candidate.model),
  }));
});

const threadDetailEffect = (store: MetaClankerStore, id: ThreadId) =>
  mapStoreError(store.getThread(id));

const shellProjectsEffect = (store: MetaClankerStore) =>
  mapStoreError(store.shellSnapshot).pipe(Effect.map((snapshot) => snapshot.projects));

const publishStatusWith = (
  store: MetaClankerStore,
  fanout: EventFanoutService,
  threadId: ThreadId,
  status: ThreadStatus,
) =>
  mapStoreError(store.setThreadStatus(threadId, status)).pipe(
    Effect.flatMap((sequence) => {
      const event = { type: "thread-status", sequence, threadId, status } as const;
      return fanout.publishThread(threadId, event).pipe(Effect.andThen(fanout.publishShell(event)));
    }),
  );

const persistMessageWith = (
  store: MetaClankerStore,
  fanout: EventFanoutService,
  input: Omit<Message, "sequence">,
) =>
  mapStoreError(store.appendMessage(input)).pipe(
    Effect.tap((persisted) =>
      fanout.publishThread(persisted.record.threadId, {
        type: "message-upserted",
        sequence: persisted.eventSequence,
        message: persisted.record,
      }),
    ),
    Effect.map((persisted) => persisted.record),
  );

const persistToolCallWith = (
  store: MetaClankerStore,
  fanout: EventFanoutService,
  input: UpsertToolCallRecord,
) =>
  mapStoreError(store.upsertToolCall(input)).pipe(
    Effect.flatMap((persisted) =>
      fanout.publishThread(persisted.record.threadId, {
        type: "tool-upserted",
        sequence: persisted.eventSequence,
        toolCall: persisted.record,
      }),
    ),
  );

const persistInteractionWith = (
  store: MetaClankerStore,
  fanout: EventFanoutService,
  input: Omit<PendingInteraction, "sequence">,
) =>
  mapStoreError(store.upsertInteraction(input)).pipe(
    Effect.tap((persisted) =>
      fanout.publishThread(persisted.record.threadId, {
        type: "interaction-upserted",
        sequence: persisted.eventSequence,
        interaction: persisted.record,
      }),
    ),
    Effect.map((persisted) => persisted.record),
  );

const persistNodeWith = (store: MetaClankerStore, fanout: EventFanoutService, node: AgentNode) =>
  mapStoreError(store.upsertAgentNode(node)).pipe(
    Effect.flatMap((persisted) =>
      fanout.publishThread(node.threadId, {
        type: "agent-node-upserted",
        sequence: persisted.eventSequence,
        node,
      }),
    ),
  );

const openThreadSessionEffect = (
  commands: Readonly<Record<Provider, AdapterCommand>>,
  detail: ThreadDetail,
  project: Project,
  options: Pick<TurnContext, "effort" | "permissionMode">,
) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const supervisor = yield* TurnSupervisor;
    const current = supervisor.session(detail.thread.id);
    if (current !== undefined) return current;
    const handle = yield* supervisor.acquire(
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
    yield* mapStoreError(
      store.replaceProviderModels(
        detail.thread.provider,
        handle.capabilities.models,
        new Date().toISOString(),
      ),
    );
    const continuationSafety = hasSafeContinuationBoundary(handle.capabilities) ? "safe" : "unsafe";
    const persistedSafety = yield* mapStoreError(
      store.getProviderContinuationSafety(detail.thread.id),
    );
    if (
      detail.thread.providerSessionId !== handle.providerSessionId ||
      persistedSafety !== continuationSafety
    ) {
      yield* mapStoreError(
        store.setProviderSession(detail.thread.id, handle.providerSessionId, continuationSafety),
      );
    }
    if (!supervisor.registerSession(detail.thread.id, handle)) {
      yield* handle.abort;
      return yield* Effect.fail(
        applicationError("conflict", "The server runtime is shutting down"),
      );
    }
    yield* supervisor.attachSession(detail.thread.id, handle);
    return handle;
  }).pipe(Effect.onError(() => Effect.logWarning("Failed to open an ACP session")));

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
  readonly pendingInteractionIds: Set<PendingInteractionId>;
  readonly finishTurn: () => void;
}

const eventWriter =
  (store: MetaClankerStore, fanout: EventFanoutService, context: TurnContext) =>
  (event: NormalizedAgentEvent): Effect.Effect<void, ApplicationError> => {
    if (event.type === "runtime-failure") {
      // Provider envelopes can contain prompts and absolute paths; never log or expose them.
      return Effect.logWarning("Agent session reported a runtime failure");
    }
    if (event.type === "capability-degraded") {
      return persistMessageWith(store, fanout, {
        id: MessageId.make(crypto.randomUUID()),
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        role: "system",
        content:
          "The provider's subagent metadata changed. Chat remains available, but the agent graph is degraded.",
        createdAt: new Date().toISOString(),
      }).pipe(Effect.asVoid);
    }
    if (event.type === "agent-message-chunk") {
      return persistMessageWith(store, fanout, {
        id: context.agentMessageId,
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        role: "agent",
        content: event.chunk,
        createdAt: context.startedAt,
      }).pipe(Effect.asVoid);
    }
    if (event.type === "thought-chunk") {
      return persistMessageWith(store, fanout, {
        id: context.thoughtMessageId,
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        role: "thought",
        content: event.chunk,
        createdAt: context.startedAt,
      }).pipe(Effect.asVoid);
    }
    if (event.type === "plan") {
      return persistMessageWith(store, fanout, {
        id: context.planMessageId,
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        role: "system",
        content: event.content,
        createdAt: context.startedAt,
      }).pipe(Effect.asVoid);
    }
    if (event.type === "tool-call") {
      const now = new Date().toISOString();
      return persistToolCallWith(store, fanout, {
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
    }
    if (event.type === "permission") {
      return Effect.gen(function* () {
        const interaction = yield* persistInteractionWith(store, fanout, event.interaction);
        yield* Effect.sync(() => context.pendingInteractionIds.add(interaction.id));
        yield* persistNodeWith(store, fanout, {
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
        yield* publishStatusWith(store, fanout, context.detail.thread.id, "needs-input");
      });
    }
    if (event.type === "agent-node") return persistNodeWith(store, fanout, event.node);
    return Effect.void;
  };

const settlePendingInteractionsEffect = (
  store: MetaClankerStore,
  fanout: EventFanoutService,
  context: TurnContext,
  status: "cancelled" | "stale",
) =>
  Effect.forEach(
    context.pendingInteractionIds,
    (interactionId) =>
      mapStoreError(store.findInteraction(interactionId)).pipe(
        Effect.flatMap((current) => {
          if (current?.status !== "pending") return Effect.void;
          return mapStoreError(store.resolveInteraction(interactionId, status)).pipe(
            Effect.flatMap((persisted) =>
              fanout.publishThread(persisted.record.threadId, {
                type: "interaction-upserted",
                sequence: persisted.eventSequence,
                interaction: { ...persisted.record, sequence: persisted.eventSequence },
              }),
            ),
          );
        }),
      ),
    { discard: true },
  );

const executePromptWork = (
  context: TurnContext,
  text: string,
  attachments: ReadonlyArray<string>,
  commands: Readonly<Record<Provider, AdapterCommand>>,
) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const checkpoints = yield* CheckpointsService;
    const supervisor = yield* TurnSupervisor;
    const fanout = yield* EventFanout;
    const claimed = yield* mapStoreError(
      store.claimPromptIntent(
        context.turnId,
        context.leaseId,
        new Date(Date.now() + 5 * 60_000).toISOString(),
      ),
    );
    if (claimed === null) {
      return yield* Effect.fail(
        applicationError("conflict", "Prompt work is no longer eligible to run"),
      );
    }
    const preTurn = yield* checkpoints.capture(context.project.path);
    yield* mapStoreError(
      store.saveCheckpoint({
        checkpoint: preTurn,
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        kind: "pre-turn",
      }),
    );
    const handle = yield* mapStoreError(
      store.transitionPromptIntent(
        context.turnId,
        context.leaseId,
        "opening-session",
        new Date().toISOString(),
      ),
    );
    if (!handle) {
      return yield* Effect.fail(applicationError("conflict", "Prompt work lease was lost"));
    }
    const session = yield* openThreadSessionEffect(
      commands,
      context.detail,
      context.project,
      context,
    );
    const dispatching = yield* mapStoreError(
      store.transitionPromptIntent(
        context.turnId,
        context.leaseId,
        "dispatching-provider",
        new Date().toISOString(),
      ),
    );
    if (!dispatching) {
      return yield* Effect.fail(applicationError("conflict", "Prompt work lease was lost"));
    }
    context.dispatchStarted.value = true;
    const outcome = yield* session.prompt({ turnId: context.turnId, text, attachments });
    if (hasSafeContinuationBoundary(session.capabilities)) {
      yield* supervisor.retireSession(context.detail.thread.id, session);
    } else {
      yield* supervisor.drainSessionEvents(context.detail.thread.id, session);
    }
    yield* settlePendingInteractionsEffect(
      store,
      fanout,
      context,
      outcome.stopReason === "cancelled" ? "cancelled" : "stale",
    );
    yield* publishStatusWith(store, fanout, context.detail.thread.id, outcome.stopReason);
    const persistCompletedNode = (changedFileCount: number) =>
      persistNodeWith(store, fanout, {
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
      });
    yield* persistCompletedNode(0);
    const postTurn = yield* checkpoints.capture(context.project.path);
    yield* mapStoreError(
      store.saveCheckpoint({
        checkpoint: postTurn,
        threadId: context.detail.thread.id,
        turnId: context.turnId,
        kind: "post-turn",
      }),
    );
    const workspaceDiff = yield* checkpoints.diff(preTurn, postTurn);
    yield* persistCompletedNode(workspaceDiff.files.length);
    return outcome.stopReason;
  }).pipe(Effect.withSpan("agent.prompt.execute"));

/**
 * Every turn failure now carries its own identity, so the choice between
 * `recovery-required` and `failed` is a checked tag rather than a string comparison a
 * new port error could silently fall through.
 */
export type TurnFailure = SessionFailure | CheckpointError;

const isConnectionFailure = (cause: TurnFailure): boolean =>
  cause._tag === "AcpRuntimeError" &&
  (cause.code === "disconnected" || cause.code === "process-exit");

const failureTurnStatus = (cause: TurnFailure): TurnCompletionStatus =>
  isConnectionFailure(cause) ? "recovery-required" : "failed";

const recordPromptFailureEffect = (context: TurnContext, cause: TurnFailure) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const fanout = yield* EventFanout;
    const supervisor = yield* TurnSupervisor;
    const status = context.dispatchStarted.value ? "recovery-required" : failureTurnStatus(cause);
    if (isConnectionFailure(cause)) yield* supervisor.evictSession(context.detail.thread.id);
    yield* settlePendingInteractionsEffect(store, fanout, context, "stale");
    yield* publishStatusWith(store, fanout, context.detail.thread.id, status);
    yield* mapStoreError(store.completeTurn(context.turnId, status, new Date().toISOString()));
    yield* persistMessageWith(store, fanout, {
      id: MessageId.make(crypto.randomUUID()),
      threadId: context.detail.thread.id,
      turnId: context.turnId,
      role: "system",
      content: "The agent connection failed. This turn was preserved and was not sent again.",
      createdAt: new Date().toISOString(),
    });
  });

const executePrompt = (
  context: TurnContext,
  text: string,
  attachments: ReadonlyArray<string>,
  commands: Readonly<Record<Provider, AdapterCommand>>,
): Effect.Effect<void, TurnFailure, Store | CheckpointsService | TurnSupervisor | EventFanout> =>
  executePromptWork(context, text, attachments, commands).pipe(
    Effect.tap((status) =>
      Effect.gen(function* () {
        const store = yield* Store;
        yield* mapStoreError(store.completeTurn(context.turnId, status, new Date().toISOString()));
      }),
    ),
    Effect.ensuring(Effect.sync(context.finishTurn)),
    Effect.asVoid,
  );

const submitAgentWorkEffect = (
  correlation: TurnContext,
  work: Effect.Effect<void, TurnFailure, Store | CheckpointsService | TurnSupervisor | EventFanout>,
) =>
  Effect.gen(function* () {
    const supervisor = yield* TurnSupervisor;
    const diagnostics = yield* LocalDiagnostics;
    const store = yield* Store;
    const checkpoints = yield* CheckpointsService;
    const fanout = yield* EventFanout;
    const submittedAt = Date.now();
    const provideTurnServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(Store, store),
        Effect.provideService(CheckpointsService, checkpoints),
        Effect.provideService(TurnSupervisor, supervisor),
        Effect.provideService(EventFanout, fanout),
      );
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
        supervisor.setEventHandler(
          correlation.detail.thread.id,
          eventWriter(store, fanout, correlation),
        );
        yield* provideTurnServices(work);
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
          provideTurnServices(recordPromptFailureEffect(correlation, cause)).pipe(
            Effect.catch(() => Effect.logError("Failed to record an agent prompt failure")),
          ),
        ),
        Effect.onInterrupt(() =>
          provideTurnServices(
            recordPromptFailureEffect(
              correlation,
              applicationError("conflict", "Agent work was interrupted during shutdown"),
            ),
          ).pipe(Effect.catch(() => Effect.logError("Failed to record interrupted agent work"))),
        ),
      ),
    );
  });

export const dispatchPromptEffect = Effect.fn("AgentCommands.dispatchPrompt")(function* (
  commands: Readonly<Record<Provider, AdapterCommand>>,
  readiness: Readonly<Record<Provider, boolean>>,
  commandId: CommandId,
  threadId: ThreadId,
  text: string,
  attachments: ReadonlyArray<string>,
) {
  const store = yield* Store;
  const supervisor = yield* TurnSupervisor;
  const fanout = yield* EventFanout;
  const detail = yield* threadDetailEffect(store, threadId);
  if (detail === null) return yield* Effect.fail(applicationError("not-found", "Thread not found"));
  const projects = yield* shellProjectsEffect(store);
  if (!readiness[detail.thread.provider]) {
    return yield* Effect.fail(
      applicationError(
        "provider-unavailable",
        `The ${detail.thread.provider} provider is unavailable`,
      ),
    );
  }
  const project = projects.find((candidate) => candidate.id === detail.thread.projectId);
  if (project === undefined) {
    return yield* Effect.fail(applicationError("not-found", "Owning project not found"));
  }
  const existingSession = supervisor.session(threadId);
  const persistedContinuationSafety = yield* mapStoreError(
    store.getProviderContinuationSafety(threadId),
  );
  if (
    continuationIsBlocked(
      persistedContinuationSafety,
      supervisor.continuationSafety(threadId),
      existingSession?.capabilities,
    )
  ) {
    return yield* Effect.fail(
      applicationError(
        "conflict",
        "This provider cannot safely correlate a follow-up turn; start a new thread",
      ),
    );
  }
  const providerDefaults = (yield* mapStoreError(store.getSettings)).providerDefaults[
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
  const started = yield* mapStoreError(
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

  supervisor.startTurn(threadId);
  const statusEvent = {
    type: "thread-status",
    sequence: started.statusEventSequence,
    threadId,
    status: "running",
  } as const;
  yield* fanout.publishThread(threadId, statusEvent);
  yield* fanout.publishShell(statusEvent);
  yield* fanout.publishThread(threadId, {
    type: "message-upserted",
    sequence: started.messageEventSequence,
    message: started.userMessage,
  });
  yield* fanout.publishThread(threadId, {
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
    pendingInteractionIds: new Set(),
    finishTurn: () => supervisor.finishTurn(threadId),
  };
  yield* submitAgentWorkEffect(context, executePrompt(context, text, attachments, commands));
  return started.turnId;
});

export const dispatchPrompt = async (
  commandId: CommandId,
  threadId: ThreadId,
  text: string,
  attachments: ReadonlyArray<string>,
): Promise<TurnId> => {
  const adapters = await applicationProviderAdapters();
  return runApplication(
    dispatchPromptEffect(
      adapters.commands,
      adapters.readiness,
      commandId,
      threadId,
      text,
      attachments,
    ),
  );
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

export const startThreadWithPromptEffect = Effect.fn("AgentCommands.startThread")(function* (
  commands: Readonly<Record<Provider, AdapterCommand>>,
  readiness: Readonly<Record<Provider, boolean>>,
  input: StartThreadWithPromptInput,
) {
  const store = yield* Store;
  const supervisor = yield* TurnSupervisor;
  const fanout = yield* EventFanout;
  if (!readiness[input.provider]) {
    return yield* Effect.fail(
      applicationError("provider-unavailable", `The ${input.provider} provider is unavailable`),
    );
  }
  const projects = yield* shellProjectsEffect(store);
  const project = projects.find((candidate) => candidate.id === input.projectId);
  if (project === undefined) {
    return yield* Effect.fail(applicationError("not-found", "Project not found"));
  }

  const threadId = ThreadId.make(crypto.randomUUID());
  const turnId = TurnId.make(crypto.randomUUID());
  const startedAt = new Date().toISOString();
  const started = yield* mapStoreError(
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
    return { accepted: true as const, thread: started.thread, turnId: started.turnId };
  }

  if (started.threadEventSequence !== null) {
    yield* fanout.publishShell({
      type: "thread-upserted",
      sequence: started.threadEventSequence,
      thread: started.thread,
    });
  }

  const detail = yield* threadDetailEffect(store, started.thread.id);
  if (detail === null) {
    return yield* Effect.fail(
      applicationError("persistence", "Accepted thread could not be loaded"),
    );
  }
  const rootNodeId = AgentNodeId.make(`root:${started.thread.id}`);
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
    pendingInteractionIds: new Set(),
    finishTurn: () => supervisor.finishTurn(started.thread.id),
  };
  yield* submitAgentWorkEffect(
    context,
    persistNodeWith(store, fanout, {
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
    }).pipe(Effect.andThen(executePrompt(context, input.prompt, input.attachments, commands))),
  );

  return { accepted: true as const, thread: started.thread, turnId: started.turnId };
});

export const startThreadWithPrompt = async (
  input: StartThreadWithPromptInput,
): Promise<StartThreadWithPromptResult> => {
  const adapters = await applicationProviderAdapters();
  return runApplication(startThreadWithPromptEffect(adapters.commands, adapters.readiness, input));
};

const publishStatusEffect = (
  store: MetaClankerStore,
  fanout: EventFanoutService,
  threadId: ThreadId,
  status: ThreadStatus,
) =>
  mapStoreError(store.setThreadStatus(threadId, status)).pipe(
    Effect.flatMap((sequence) => {
      const event = { type: "thread-status", sequence, threadId, status } as const;
      return fanout.publishThread(threadId, event).pipe(Effect.andThen(fanout.publishShell(event)));
    }),
  );

export const cancelPromptEffect = Effect.fn("AgentCommands.cancelPrompt")(function* (
  commandId: CommandId,
  threadId: ThreadId,
) {
  const store = yield* Store;
  const supervisor = yield* TurnSupervisor;
  const fanout = yield* EventFanout;
  if ((yield* mapStoreError(store.findReceipt(commandId))) !== null) return;
  const session = supervisor.session(threadId);
  if (session === undefined || !supervisor.hasActiveTurn(threadId)) {
    return yield* Effect.fail(applicationError("conflict", "No active turn"));
  }
  const admitted = yield* mapStoreError(
    store.admitCancel({
      commandId,
      threadId,
      leaseId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }),
  );
  if (!admitted.acceptedNow) return;
  const cancelling = {
    type: "thread-status",
    sequence: admitted.eventSequence,
    threadId,
    status: "cancelling",
  } as const;
  yield* fanout.publishThread(threadId, cancelling);
  yield* fanout.publishShell(cancelling);

  const markUncertain = Effect.gen(function* () {
    const marked = yield* mapStoreError(
      store.markCancelUncertain(admitted.turnId, admitted.leaseId, new Date().toISOString()),
    );
    if (!marked) {
      return yield* Effect.fail(applicationError("conflict", "Cancellation work lease was lost"));
    }
    yield* publishStatusEffect(store, fanout, threadId, "recovery-required");
    yield* mapStoreError(
      store.completeTurn(admitted.turnId, "recovery-required", new Date().toISOString()),
    );
  }).pipe(
    Effect.catch(() => Effect.logWarning("Failed to mark an interrupted cancellation uncertain")),
  );

  yield* session.requestCancel().pipe(
    Effect.mapError(() => applicationError("persistence", "Provider cancellation failed")),
    Effect.flatMap(() =>
      mapStoreError(
        store.markCancelAwaiting(admitted.turnId, admitted.leaseId, new Date().toISOString()),
      ),
    ),
    Effect.flatMap((awaiting) =>
      awaiting
        ? Effect.void
        : Effect.fail(applicationError("conflict", "Cancellation work is no longer active")),
    ),
    Effect.tapError(() => markUncertain),
    Effect.onInterrupt(() => markUncertain),
  );
});

export const cancelPrompt = (commandId: CommandId, threadId: ThreadId): Promise<void> =>
  runApplication(cancelPromptEffect(commandId, threadId));

export const respondToInteractionEffect = Effect.fn("AgentCommands.respondToInteraction")(
  function* (commandId: CommandId, interactionId: PendingInteractionId, optionId: string) {
    const store = yield* Store;
    const supervisor = yield* TurnSupervisor;
    const fanout = yield* EventFanout;
    const admitted = yield* mapStoreError(
      store.admitInteractionResponse({
        commandId,
        interactionId,
        optionId,
        leaseId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    );
    if (!admitted.acceptedNow) return admitted.interaction;
    yield* fanout.publishThread(admitted.interaction.threadId, {
      type: "interaction-upserted",
      sequence: admitted.eventSequence,
      interaction: admitted.interaction,
    });
    const session = supervisor.session(admitted.interaction.threadId);
    if (session === undefined) {
      const persisted = yield* mapStoreError(
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
      yield* fanout.publishThread(stale.threadId, {
        type: "interaction-upserted",
        sequence: persisted.eventSequence,
        interaction: stale,
      });
      yield* publishStatusEffect(store, fanout, stale.threadId, "recovery-required");
      return stale;
    }
    const markUncertain = Effect.gen(function* () {
      const persisted = yield* mapStoreError(
        store.settleInteractionResponse(
          interactionId,
          admitted.leaseId,
          "stale",
          "uncertain",
          new Date().toISOString(),
          "provider-response-uncertain",
        ),
      );
      yield* fanout.publishThread(persisted.record.threadId, {
        type: "interaction-upserted",
        sequence: persisted.eventSequence,
        interaction: persisted.record,
      });
      yield* publishStatusEffect(store, fanout, persisted.record.threadId, "recovery-required");
    }).pipe(
      Effect.catch(() => Effect.logWarning("Failed to mark an interaction response uncertain")),
    );
    yield* publishStatusEffect(store, fanout, admitted.interaction.threadId, "running");
    yield* session.respondInteraction(interactionId, optionId).pipe(
      Effect.mapError(() => applicationError("persistence", "Provider response failed")),
      Effect.tapError(() => markUncertain),
      Effect.onInterrupt(() => markUncertain),
    );
    const persisted = yield* mapStoreError(
      store.settleInteractionResponse(
        interactionId,
        admitted.leaseId,
        "resolved",
        "succeeded",
        new Date().toISOString(),
      ),
    );
    const resolved = persisted.record;
    yield* fanout.publishThread(resolved.threadId, {
      type: "interaction-upserted",
      sequence: persisted.eventSequence,
      interaction: resolved,
    });
    return resolved;
  },
);

export const respondToInteraction = (
  commandId: CommandId,
  interactionId: PendingInteractionId,
  optionId: string,
): Promise<PendingInteraction> =>
  runApplication(respondToInteractionEffect(commandId, interactionId, optionId));

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

export const restoreThreadFilesEffect = Effect.fn("AgentCommands.restoreThreadFiles")(function* (
  commandId: CommandId,
  threadId: ThreadId,
  checkpointId: CheckpointId,
) {
  const store = yield* Store;
  const supervisor = yield* TurnSupervisor;
  const checkpoints = yield* CheckpointsService;
  const fanout = yield* EventFanout;
  const detail = yield* mapStoreError(store.getThread(threadId));
  if (detail === null) {
    return yield* Effect.fail(applicationError("not-found", "Thread not found"));
  }
  if (supervisor.hasActiveTurn(threadId)) {
    return yield* Effect.fail(
      applicationError("conflict", "Files can be restored only while the session is idle"),
    );
  }
  const records = yield* mapStoreError(store.listCheckpoints(threadId));
  const record = records.find((candidate) => candidate.checkpoint.id === checkpointId);
  if (record === undefined) {
    return yield* Effect.fail(applicationError("not-found", "Checkpoint not found"));
  }
  const admitted = yield* mapStoreError(
    store.admitRestore({
      commandId,
      threadId,
      checkpointId,
      undoCheckpointId: CheckpointId.make(crypto.randomUUID()),
      leaseId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }),
  );
  if (!admitted.acceptedNow) {
    const undo = records.find((candidate) => candidate.checkpoint.id === admitted.undoCheckpointId);
    if (undo === undefined) {
      return yield* Effect.fail(
        applicationError("persistence", "Accepted restore has no durable undo checkpoint"),
      );
    }
    return toPersistedCheckpointWire(undo);
  }

  const markUncertain = mapStoreError(
    store.markRestoreUncertain(commandId, admitted.leaseId, threadId, new Date().toISOString()),
  ).pipe(
    Effect.flatMap((sequence) => {
      if (sequence === null) return Effect.void;
      const event = {
        type: "thread-status",
        sequence,
        threadId,
        status: "recovery-required",
      } as const;
      return fanout.publishThread(threadId, event).pipe(Effect.andThen(fanout.publishShell(event)));
    }),
    Effect.catch(() => Effect.logWarning("Failed to mark an interrupted restore as uncertain")),
  );

  const criticalRestore = checkpoints.restore(record.checkpoint, admitted.undoCheckpointId).pipe(
    Effect.mapError(() => applicationError("persistence", "Checkpoint restore failed")),
    Effect.flatMap((undo) =>
      mapStoreError(
        store.completeRestore(commandId, admitted.leaseId, {
          checkpoint: undo,
          threadId,
          turnId: record.turnId,
          kind: "undo",
        }),
      ),
    ),
    Effect.tapError(() => markUncertain),
    Effect.onInterrupt(() => markUncertain),
  );
  const persisted = yield* criticalRestore;
  if (persisted === null) {
    return yield* Effect.fail(applicationError("conflict", "Restore work lease was lost"));
  }
  const message = yield* mapStoreError(
    store.appendMessage({
      id: MessageId.make(crypto.randomUUID()),
      threadId,
      turnId: record.turnId,
      role: "system",
      content:
        "Files were restored to the selected checkpoint. The provider conversation was not rewound; continue in a new session if the restored state changes the task context.",
      createdAt: new Date().toISOString(),
    }),
  );
  yield* fanout.publishThread(threadId, {
    type: "message-upserted",
    sequence: message.eventSequence,
    message: message.record,
  });
  return toPersistedCheckpointWire(persisted);
});

export const restoreThreadFiles = (
  commandId: CommandId,
  threadId: ThreadId,
  checkpointId: CheckpointId,
) => runApplication(restoreThreadFilesEffect(commandId, threadId, checkpointId));

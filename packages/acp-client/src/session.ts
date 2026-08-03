import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import * as acp from "@agentclientprotocol/sdk";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type {
  AcpSessionHandle,
  AcpSessions,
  NormalizedAgentEvent,
  OpenAcpSessionInput,
  SessionCapabilities,
} from "@metaclanker/application/ports";
import { AcpRuntimeError } from "@metaclanker/application/ports";
import { AgentNodeId, PendingInteractionId } from "@metaclanker/contracts/ids";
import type { TurnId } from "@metaclanker/contracts/ids";
import type { PermissionOption, Provider } from "@metaclanker/contracts/wire";

import { decodeSubagentMetadata, normalizeSessionUpdate } from "./normalize.js";

export const compatibility = {
  protocolVersion: 1,
  sdkVersion: "1.3.0",
  adapters: {
    codex: "1.1.7",
    claude: "0.64.0",
  },
} as const;

export interface AdapterCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly environment?:
    | Readonly<Record<string, string>>
    | (() => Readonly<Record<string, string>>);
  readonly onSpawn?: (pid: number) => void;
}

export const adapterEntry = (provider: Provider): string => {
  const specifier =
    provider === "codex"
      ? "@agentclientprotocol/codex-acp"
      : "@agentclientprotocol/claude-agent-acp";
  const clientPackage = realpathSync(
    resolvePath(process.cwd(), "node_modules/@metaclanker/acp-client/package.json"),
  );
  const adapterPackage = findPackageJSON(specifier, pathToFileURL(clientPackage).href);
  if (adapterPackage === undefined) {
    throw new Error(`The ${provider} ACP adapter is not installed`);
  }
  return resolvePath(dirname(adapterPackage), "dist/index.js");
};

export const realAdapterCommands = (): Readonly<Record<Provider, AdapterCommand>> => ({
  codex: { command: process.execPath, args: [adapterEntry("codex")] },
  claude: { command: process.execPath, args: [adapterEntry("claude")] },
});

const runtimeFailure = (code: AcpRuntimeError["code"], cause: unknown): AcpRuntimeError =>
  new AcpRuntimeError({ code, message: cause instanceof Error ? cause.message : String(cause) });

const permissionKind = (kind: acp.PermissionOptionKind): PermissionOption["kind"] => {
  if (kind === "allow_once") return "allow-once";
  if (kind === "allow_always") return "allow-always";
  if (kind === "reject_once") return "reject-once";
  return "reject-always";
};

const mapCapabilities = (response: acp.InitializeResponse): SessionCapabilities => {
  const agent = response.agentCapabilities;
  const sessions = agent?.sessionCapabilities;
  return {
    protocolVersion: 1,
    resume: sessions?.resume != null,
    load: agent?.loadSession === true,
    close: sessions?.close != null,
    delete: sessions?.delete != null,
    graph: "available",
    models: [],
    modes: [],
  };
};

const outcome = (reason: acp.StopReason) => {
  if (reason === "cancelled") return "cancelled" as const;
  return "completed" as const;
};

const subagentState = (status: acp.ToolCallStatus | null | undefined) => {
  if (status === "failed") return "failed" as const;
  if (status === "completed") return "completed" as const;
  return "running" as const;
};

const providerPermissionMode = (
  provider: Provider,
  permissionMode: OpenAcpSessionInput["permissionMode"],
): string | null => {
  if (permissionMode === null) return null;
  if (provider === "claude") {
    if (permissionMode === "read-only") return "plan";
    if (permissionMode === "workspace-write") return "acceptEdits";
    return "bypassPermissions";
  }
  if (permissionMode === "workspace-write") return "agent";
  if (permissionMode === "full-access") return "agent-full-access";
  return permissionMode;
};

interface PendingPermission {
  readonly resolve: (response: acp.RequestPermissionResponse) => void;
  readonly sessionId: string;
}

type SessionEventItem =
  | { readonly type: "events"; readonly events: ReadonlyArray<NormalizedAgentEvent> }
  | { readonly type: "barrier"; readonly completed: Deferred.Deferred<void> };

const writableToChild = (child: ReturnType<typeof spawn>): WritableStream<Uint8Array> => {
  const stdin = child.stdin;
  // Node emits stream errors even when the write callback receives the same error.
  stdin?.on("error", () => undefined);
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (stdin === null || stdin.destroyed || stdin.writableEnded) {
          reject(new Error("ACP adapter stdin is unavailable"));
          return;
        }
        stdin.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    },
    close() {
      if (stdin !== null && !stdin.destroyed && !stdin.writableEnded) stdin.end();
    },
  });
};

const readableFromChild = (child: ReturnType<typeof spawn>): ReadableStream<Uint8Array> => {
  let finished = false;
  return new ReadableStream({
    start(controller) {
      const stdout = child.stdout;
      if (stdout === null) {
        finished = true;
        controller.error(new Error("ACP adapter stdout is unavailable"));
        return;
      }
      stdout.on("data", (chunk: Buffer) => {
        if (!finished) controller.enqueue(chunk);
      });
      stdout.on("end", () => {
        if (finished) return;
        finished = true;
        controller.close();
      });
      stdout.on("error", (error) => {
        if (finished) return;
        finished = true;
        controller.error(error);
      });
    },
    cancel() {
      finished = true;
    },
  });
};

const terminateChild = async (child: ReturnType<typeof spawn>): Promise<void> => {
  child.stdin?.end();
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(force);
      child.off("exit", finish);
      child.off("error", finish);
      resolve();
    };
    const force = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000);
    force.unref();
    child.once("exit", finish);
    child.once("error", finish);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
};

const terminateChildEffect = (child: ReturnType<typeof spawn>): Effect.Effect<void> =>
  Effect.tryPromise({ try: () => terminateChild(child), catch: () => undefined }).pipe(
    Effect.catch(() => Effect.void),
  );

const openSessionInScope = (
  input: OpenAcpSessionInput,
  adapter: AdapterCommand,
): Effect.Effect<AcpSessionHandle, AcpRuntimeError, Scope.Scope> =>
  Effect.gen(function* () {
    const permissionMode = providerPermissionMode(input.provider, input.permissionMode);
    const codexConfig = {
      ...(input.model === null ? {} : { model: input.model }),
      ...(input.effort === null ? {} : { model_reasoning_effort: input.effort }),
    };
    const sessionEnvironment =
      input.provider === "codex"
        ? {
            ...(Object.keys(codexConfig).length === 0
              ? {}
              : { CODEX_CONFIG: JSON.stringify(codexConfig) }),
            ...(permissionMode === null ? {} : { INITIAL_AGENT_MODE: permissionMode }),
          }
        : {};
    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          spawn(adapter.command, [...adapter.args], {
            cwd: input.cwd,
            env: {
              ...process.env,
              ...(typeof adapter.environment === "function"
                ? adapter.environment()
                : adapter.environment),
              ...sessionEnvironment,
            },
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          }),
        catch: (cause) => runtimeFailure("spawn", cause),
      }),
      terminateChildEffect,
    );
    const diagnostics: string[] = [];
    if (child.pid !== undefined) adapter.onSpawn?.(child.pid);
    let diagnosticBytes = 0;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const redacted = chunk
        .replaceAll(input.cwd, "<project>")
        .replace(/(token|secret|password)=\S+/giu, "$1=<redacted>");
      diagnostics.push(redacted);
      diagnosticBytes += Buffer.byteLength(redacted);
      while (diagnosticBytes > 64 * 1024 && diagnostics.length > 1) {
        const removed = diagnostics.shift();
        diagnosticBytes -= Buffer.byteLength(removed ?? "");
      }
    });

    let activeTurnId: typeof TurnId.Type | null = null;
    let providerSessionId: string | null = input.providerSessionId;
    let ignoreReplay = input.providerSessionId !== null;
    const permissions = new Map<string, PendingPermission>();
    const rootNodeId = AgentNodeId.make(`root:${input.threadId}`);
    const claudeNodesByTool = new Map<string, typeof AgentNodeId.Type>();
    const eventQueue = yield* Queue.bounded<SessionEventItem, AcpRuntimeError | Cause.Done>(256);
    let terminalFailure: AcpRuntimeError | null = null;
    let capabilities: SessionCapabilities = {
      protocolVersion: 1,
      resume: false,
      load: false,
      close: false,
      delete: false,
      graph: "available",
      models: [],
      modes: [],
    };

    const overflow = (): AcpRuntimeError =>
      runtimeFailure("event-overflow", "ACP event ingestion exceeded its bounded capacity");

    const offerEvents = (events: ReadonlyArray<NormalizedAgentEvent>): boolean => {
      if (events.length === 0) return true;
      if (Queue.offerUnsafe(eventQueue, { type: "events", events })) return true;
      if (terminalFailure !== null) return false;
      terminalFailure = overflow();
      Queue.failCauseUnsafe(eventQueue, Cause.fail(terminalFailure));
      void terminateChild(child);
      return false;
    };

    const emitUpdate = (update: acp.SessionUpdate): void => {
      if (activeTurnId === null || ignoreReplay) return;
      const events: NormalizedAgentEvent[] = [...normalizeSessionUpdate(update)];
      const decodedMetadata = decodeSubagentMetadata(input.provider, update._meta);
      if (decodedMetadata.status === "invalid") {
        if (capabilities.graph !== "degraded") {
          capabilities = { ...capabilities, graph: "degraded" };
          events.push({ type: "capability-degraded", capability: "graph" });
        }
        offerEvents(events);
        return;
      }
      if (decodedMetadata.status !== "decoded") {
        offerEvents(events);
        return;
      }
      const subagent = decodedMetadata.metadata;
      if (subagent?.provider === "codex") {
        const nodeId = AgentNodeId.make(`codex:${input.threadId}:${subagent.threadId}`);
        events.push({
          type: "agent-node",
          node: {
            id: nodeId,
            threadId: input.threadId,
            parentId: rootNodeId,
            name: subagent.path ?? `Codex subagent ${subagent.threadId.slice(0, 8)}`,
            provider: "codex",
            model: null,
            state: subagent.activity === "interrupted" ? "interrupted" : "running",
            activity: subagent.activity,
            childCount: 0,
            pendingApproval: false,
            changedFileCount: 0,
          },
        });
      }
      if (
        subagent?.provider === "claude" &&
        (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")
      ) {
        const nodeId =
          claudeNodesByTool.get(update.toolCallId) ??
          AgentNodeId.make(`claude:${input.threadId}:${update.toolCallId}`);
        claudeNodesByTool.set(update.toolCallId, nodeId);
        const parentId =
          subagent.parentToolUseId === null
            ? rootNodeId
            : (claudeNodesByTool.get(subagent.parentToolUseId) ?? rootNodeId);
        events.push({
          type: "agent-node",
          node: {
            id: nodeId,
            threadId: input.threadId,
            parentId,
            name: update.title ?? "Claude subagent",
            provider: "claude",
            model: null,
            state: subagentState(update.status),
            activity: update.title ?? "Working",
            childCount: 0,
            pendingApproval: false,
            changedFileCount: 0,
          },
        });
      }
      offerEvents(events);
    };

    const client = acp
      .client({ name: "MetaClanker" })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (providerSessionId === null || params.sessionId !== providerSessionId) return;
        return emitUpdate(params.update);
      })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
        const id = PendingInteractionId.make(crypto.randomUUID());
        if (activeTurnId === null || params.sessionId !== providerSessionId) {
          return { outcome: { outcome: "cancelled" } };
        }
        const response = new Promise<acp.RequestPermissionResponse>((resolve) => {
          permissions.set(id, { resolve, sessionId: params.sessionId });
        });
        if (
          !offerEvents([
            {
              type: "permission",
              interaction: {
                id,
                projectId: input.projectId,
                threadId: input.threadId,
                turnId: activeTurnId,
                nodeId: rootNodeId,
                kind: "permission",
                title: params.toolCall.title ?? "Permission required",
                description: params.toolCall.rawInput
                  ? JSON.stringify(params.toolCall.rawInput, null, 2)
                  : "The agent needs permission to continue.",
                options: params.options.map((option) => ({
                  optionId: option.optionId,
                  label: option.name,
                  kind: permissionKind(option.kind),
                })),
                status: "pending",
                createdAt: new Date().toISOString(),
              },
            },
          ])
        ) {
          permissions.delete(id);
          return { outcome: { outcome: "cancelled" } };
        }
        return response;
      });

    const connection = client.connect(
      acp.ndJsonStream(writableToChild(child), readableFromChild(child)),
    );
    let sessionIdForClose: string | null = null;
    let canClose = false;
    let promptActive = false;
    let promptUsed = false;
    let closed = false;

    const expirePermissions = (): void => {
      for (const permission of permissions.values()) {
        permission.resolve({ outcome: { outcome: "cancelled" } });
      }
      permissions.clear();
    };

    const abort = Effect.suspend(() => {
      closed = true;
      activeTurnId = null;
      expirePermissions();
      connection.close();
      Queue.endUnsafe(eventQueue);
      return terminateChildEffect(child);
    }).pipe(
      Effect.catch(() => Effect.void),
      Effect.asVoid,
      Effect.withSpan("AcpSessionHandle.abort"),
    );

    const closeWithError = Effect.suspend(() => {
      if (closed) return Effect.void;
      closed = true;
      expirePermissions();
      const gracefulClose =
        canClose && sessionIdForClose !== null
          ? Effect.tryPromise({
              try: () =>
                connection.agent.request(acp.methods.agent.session.close, {
                  sessionId: sessionIdForClose,
                }),
              catch: (cause) => cause,
            }).pipe(Effect.asVoid)
          : Effect.void;
      const closeConnection = Effect.tryPromise({
        try: async () => {
          connection.close();
          await connection.closed;
        },
        catch: (cause) => cause,
      });
      const stopChild = Effect.tryPromise({
        try: () => terminateChild(child),
        catch: (cause) => cause,
      });
      return Effect.gen(function* () {
        const gracefulExit = yield* Effect.exit(gracefulClose);
        const connectionExit = yield* Effect.exit(closeConnection);
        const childExit = yield* Effect.exit(stopChild);
        activeTurnId = null;
        Queue.endUnsafe(eventQueue);
        const failed = [gracefulExit, connectionExit, childExit].find(Exit.isFailure);
        if (failed !== undefined && Exit.isFailure(failed)) {
          return yield* Effect.fail(runtimeFailure("disconnected", Cause.squash(failed.cause)));
        }
      });
    }).pipe(
      Effect.onInterrupt(() => abort),
      Effect.asVoid,
      Effect.withSpan("AcpSessionHandle.close"),
    );

    const releaseSessionResources = (cause?: unknown): void => {
      activeTurnId = null;
      expirePermissions();
      if (closed) return;
      const failure = runtimeFailure("disconnected", cause ?? "ACP connection closed");
      terminalFailure ??= failure;
      Queue.failCauseUnsafe(eventQueue, Cause.fail(failure));
      void terminateChild(child);
    };
    connection.closed.then(
      () => releaseSessionResources(),
      (cause) => releaseSessionResources(cause),
    );

    const request = <A>(
      operationName: string,
      operation: () => Promise<A>,
    ): Effect.Effect<A, AcpRuntimeError> =>
      Effect.tryPromise({
        try: operation,
        catch: (cause) => runtimeFailure("disconnected", cause),
      }).pipe(Effect.withSpan(`acp.request.${operationName}`));

    const initialize = Effect.gen(function* () {
      const initialized = yield* request("initialize", () =>
        connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            _meta: input.provider === "claude" ? { "subagent-transcript": true } : {},
          },
          clientInfo: { name: "MetaClanker", version: "0.1.0" },
        }),
      );
      if (initialized.protocolVersion !== 1) {
        return yield* Effect.fail(
          runtimeFailure(
            "protocol",
            `Adapter negotiated unsupported ACP protocol ${initialized.protocolVersion}`,
          ),
        );
      }

      const advertised = mapCapabilities(initialized);
      capabilities = advertised;
      let setupModes: acp.SessionModeState | null | undefined;
      let setupConfigOptions: ReadonlyArray<acp.SessionConfigOption> | null | undefined;
      const existingSessionId = providerSessionId;
      if (existingSessionId === null) {
        const created = yield* request("session.new", () =>
          connection.agent.request(acp.methods.agent.session.new, {
            cwd: input.cwd,
            mcpServers: [],
          }),
        );
        providerSessionId = created.sessionId;
        setupModes = created.modes;
        setupConfigOptions = created.configOptions;
        ignoreReplay = false;
      } else if (advertised.resume) {
        const resumed = yield* request("session.resume", () =>
          connection.agent.request(acp.methods.agent.session.resume, {
            sessionId: existingSessionId,
            cwd: input.cwd,
            mcpServers: [],
          }),
        );
        setupModes = resumed.modes;
        setupConfigOptions = resumed.configOptions;
        ignoreReplay = false;
      } else if (advertised.load) {
        const loaded = yield* request("session.load", () =>
          connection.agent.request(acp.methods.agent.session.load, {
            sessionId: existingSessionId,
            cwd: input.cwd,
            mcpServers: [],
          }),
        );
        setupModes = loaded.modes;
        setupConfigOptions = loaded.configOptions;
        ignoreReplay = false;
      } else {
        return yield* Effect.fail(
          runtimeFailure(
            "unsupported",
            "The provider cannot continue this saved session; start a new thread to proceed",
          ),
        );
      }

      if (providerSessionId === null) {
        return yield* Effect.fail(
          runtimeFailure("protocol", "The provider returned no session identifier"),
        );
      }
      const sessionId = providerSessionId;
      sessionIdForClose = sessionId;
      canClose = advertised.close;
      const requestedConfiguration = [
        { categories: ["model"], value: input.model },
        { categories: ["thought_level"], value: input.effort },
        { categories: ["mode"], value: permissionMode },
      ];
      for (const requested of requestedConfiguration) {
        if (requested.value === null) continue;
        const value = requested.value;
        const option = setupConfigOptions?.find(
          (candidate) =>
            candidate.type === "select" &&
            (requested.categories.includes(candidate.category ?? "") ||
              requested.categories.includes(candidate.id)),
        );
        if (option === undefined) continue;
        yield* request("session.setConfigOption", () =>
          connection.agent.request(acp.methods.agent.session.setConfigOption, {
            sessionId,
            configId: option.id,
            value,
          }),
        );
      }
      if (
        permissionMode !== null &&
        setupModes?.availableModes.some((mode) => mode.id === permissionMode) === true &&
        setupModes.currentModeId !== permissionMode
      ) {
        yield* request("session.setMode", () =>
          connection.agent.request(acp.methods.agent.session.setMode, {
            sessionId,
            modeId: permissionMode,
          }),
        );
      }
      const availableConfigValues = (category: string): ReadonlyArray<string> =>
        setupConfigOptions?.flatMap((option) => {
          if (option.type !== "select" || option.category !== category) return [];
          return option.options.flatMap((item) =>
            "value" in item ? [item.value] : item.options.map((value) => value.value),
          );
        }) ?? [];
      capabilities = {
        ...advertised,
        models: availableConfigValues("model"),
        modes: setupModes?.availableModes.map((mode) => mode.id) ?? [],
      } satisfies SessionCapabilities;
      return sessionId;
    }).pipe(Effect.tapError(() => closeWithError.pipe(Effect.catch(() => Effect.void))));

    const sessionId = yield* initialize;
    yield* Effect.addFinalizer(() => closeWithError.pipe(Effect.catch(() => abort)));
    return {
      providerSessionId: sessionId,
      get capabilities() {
        return capabilities;
      },
      events: Stream.fromQueue(eventQueue).pipe(
        Stream.filterMapEffect((item) =>
          item.type === "events"
            ? Effect.succeed(Result.succeed(item.events))
            : Deferred.succeed(item.completed, undefined).pipe(Effect.as(Result.fail(undefined))),
        ),
        Stream.flatMap(Stream.fromIterable),
      ),
      drainAcceptedEvents: Effect.gen(function* () {
        const completed = yield* Deferred.make<void>();
        const offered = yield* Queue.offer(eventQueue, { type: "barrier", completed });
        if (!offered) {
          return yield* Effect.fail(
            terminalFailure ?? runtimeFailure("disconnected", "ACP event stream is closed"),
          );
        }
        yield* Deferred.await(completed);
      }).pipe(Effect.withSpan("AcpSessionHandle.drainAcceptedEvents")),
      prompt: Effect.fn("AcpSessionHandle.prompt")((promptInput) =>
        Effect.suspend(() => {
          if (promptActive) {
            return Effect.fail(
              runtimeFailure("protocol", "Only one ordinary prompt may run per ACP session"),
            );
          }
          if (promptUsed) {
            return Effect.fail(
              runtimeFailure(
                "protocol",
                "A completed ACP session generation cannot accept another prompt",
              ),
            );
          }
          promptActive = true;
          promptUsed = true;
          activeTurnId = promptInput.turnId;
          return request("session.prompt", async () => {
            const blocks: acp.ContentBlock[] = [
              { type: "text", text: promptInput.text },
              ...promptInput.attachments.map(
                (uri): acp.ContentBlock => ({ type: "resource_link", uri, name: uri }),
              ),
            ];
            const response = await connection.agent.request<acp.PromptResponse, acp.PromptRequest>(
              acp.methods.agent.session.prompt,
              { sessionId, prompt: blocks },
            );
            return { stopReason: outcome(response.stopReason) };
          }).pipe(Effect.ensuring(Effect.sync(() => (promptActive = false))));
        }),
      ),
      requestCancel: Effect.fn("AcpSessionHandle.requestCancel")(() =>
        Effect.tryPromise({
          try: () => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }),
          catch: (cause) => runtimeFailure("disconnected", cause),
        }),
      ),
      respondInteraction: Effect.fn("AcpSessionHandle.respondInteraction")((id, optionId) =>
        Effect.gen(function* () {
          const pending = permissions.get(id);
          if (pending === undefined || pending.sessionId !== sessionId) {
            return yield* Effect.fail(
              runtimeFailure("disconnected", "Permission is stale or already resolved"),
            );
          }
          permissions.delete(id);
          pending.resolve({ outcome: { outcome: "selected", optionId } });
        }),
      ),
      close: closeWithError,
      abort,
    } satisfies AcpSessionHandle;
  });

const openSession = (
  input: OpenAcpSessionInput,
  adapter: AdapterCommand,
): Effect.Effect<AcpSessionHandle, AcpRuntimeError, Scope.Scope> =>
  Effect.gen(function* () {
    const outerScope = yield* Effect.scope;
    const sessionScope = yield* Scope.make();
    let transferred = false;
    const handle = yield* openSessionInScope(input, adapter).pipe(
      Scope.provide(sessionScope),
      Effect.onExit((exit) =>
        transferred || Exit.isSuccess(exit)
          ? Effect.void
          : Scope.close(sessionScope, exit).pipe(Effect.asVoid),
      ),
    );
    yield* Scope.addFinalizerExit(outerScope, (exit) => Scope.close(sessionScope, exit));
    transferred = true;
    return handle;
  });

export const makeAcpSessions = (
  commands: Readonly<Record<Provider, AdapterCommand>> = realAdapterCommands(),
): AcpSessions => ({
  open: (input) => openSession(input, commands[input.provider]),
});

# MetaClanker MVP Specification

Status: Draft for review  
Audience: Product and engineering  
Application type: Private, local-first application

## 1. Product definition

MetaClanker is a private meta-harness for controlling coding agents without opening separate
provider applications. Its normal experience is conversation-first, similar to T3 Code. Its defining
addition is an optional spatial map, built with Vue Flow, that makes the agent hierarchy and work in
progress understandable at a glance.

The map should feel like opening a map in a game: the user leaves the detailed local view of one
conversation and sees the larger system. It is not a workflow editor and does not replace chat.

The first release supports Codex and Claude through the Agent Client Protocol (ACP). Provider-specific
protocols and SDKs must remain behind ACP adapters.

## 2. Product goals

1. Provide one fast interface for Codex and Claude work across local repositories.
2. Preserve the conversation, tool activity, permissions, terminal output, and file-review experience
   users expect from T3 Code.
3. Make native parent-agent and subagent activity visible as a navigable graph.
4. Support both the web and Electron desktop surfaces from the first implementation milestone.
5. Make the UI customizable for a single user's workflow without forking core logic.
6. Establish architecture, tests, and automated quality feedback before feature volume grows.
7. Keep volatile provider behavior behind narrow, stable interfaces.

## 3. Non-goals for the MVP

- Mobile applications.
- Multi-tenant hosting, billing, organization accounts, or public SaaS authentication.
- A hosted relay service.
- Supporting providers other than Codex and Claude.
- Installing arbitrary agents from the ACP registry.
- ACP v2 or draft transport features.
- A visual workflow builder where users wire arbitrary tools together.
- Cross-provider orchestration invented by MetaClanker.
- Collaborative multi-user editing.
- Plugin or marketplace systems.
- A multi-environment client catalog, hosted relay, SSH environment manager, WSL specialization, or
  Tailscale endpoint-provider system.
- Worktree/branch automation or generalized non-Git version-control drivers.
- A custom terminal renderer, generated ACP fork, provider update manager, or generic provider
  registry. The MVP uses maintained libraries and an established web terminal.
- Public release channels, automatic updates, code signing, or store distribution beyond the private
  artifacts needed by the owner.

These exclusions describe the first releasable scope, not permanent product limitations.

## 4. Product principles

### 4.1 Conversation first, map on demand

Chat is the primary work surface. The map is reachable from the thread header and keyboard command.
Opening it preserves the selected project and thread. Selecting a node returns to or opens the
corresponding transcript and activity.

### 4.2 ACP is the provider boundary

The backend is an ACP client. It launches ACP agent adapters as supervised subprocesses over stdio.
The MVP pins known-compatible versions of:

- `@agentclientprotocol/codex-acp`
- `@agentclientprotocol/claude-agent-acp`

The backend uses `@agentclientprotocol/sdk` and stable ACP v1. The rest of the application must not
import Codex or Claude integration packages directly.

The MVP launches one supervised ACP adapter process per active root session. This trades process
reuse for failure isolation and simple lifecycle ownership. Native Claude subagents remain nested in
their root ACP session; this rule does not imply one process per visible graph node. Connection
pooling is a later optimization.

Compatibility is pinned as a tuple: ACP schema revision, TypeScript SDK version, adapter version, and
bundled provider runtime version. “ACP v1” alone is not a sufficient compatibility declaration.

### 4.3 Deep modules

Modules should expose small interfaces while hiding meaningful complexity. Depth is the ratio between
interface simplicity and implementation complexity; it is not permission to create oversized files.

Apply this principle especially to:

- ACP process and connection supervision.
- ACP event normalization.
- session orchestration and recovery.
- SQLite persistence and projection.
- Git checkpoint capture, diffing, and restoration.
- environment authentication.
- agent-graph derivation.

Avoid shallow wrappers that rename one call, pass every implementation option through their public
API, or require callers to understand internal sequencing. A new abstraction must hide volatility,
enforce an invariant, combine multiple operations, or provide a useful domain concept.

### 4.4 Quality is back pressure

Types, schemas, lint rules, tests, and builds are part of the instructions given to coding agents.
Checks must be fast enough to run during development and precise enough for an agent to correct its
own mistakes.

### 4.5 Remote-ready boundaries

The server owns provider processes, Git, terminals, persistence, and filesystem access. The web UI
communicates only through an authenticated server contract. Even when the MVP runs on one machine,
the UI must not assume that browser and server share a filesystem or `localhost`.

### 4.6 Performance is a feature

Streaming must be incremental and subscription-scoped. Avoid broadcasting full session snapshots,
continuously repainting animations, or making the entire message history reactive. Large transcript,
terminal, diff, and graph views must be virtualizable.

Transcript and activity history is cursor-paginated at the server. Sidebar and thread-detail
subscriptions remain separate, stream queues are bounded per subscriber, and overflow triggers an
explicit snapshot resynchronization rather than unbounded buffering.

## 5. Users and primary workflow

The MVP has one trusted user.

The critical journey is:

1. Start the desktop application or local server.
2. Add a project with the native desktop folder picker or constrained server-side browser.
3. Arrive in a focused local draft without creating a durable thread or provider session.
4. Choose Codex or Claude and select model, effort, and permission mode when supported.
5. Send the first prompt to atomically create the titled thread and initial turn.
6. Watch messages, plans, tool calls, and terminal activity stream in.
7. Respond to permissions or requested input.
8. Open the map to see the root agent and any native subagents.
9. Review changed files and diffs.
10. Continue the conversation, interrupt it, or restore a checkpoint.
11. Restart MetaClanker and recover durable state while unsent local drafts remain client-local.

## 6. Information architecture and UX

### 6.1 Application shell

The shared Vue application contains:

- A quiet project tree with nested conversations, a distinct Add project action, and contextual New chat.
- A thread header with provider, model, status, Git branch, map, and review actions.
- A central transcript.
- A composer with attachments, provider controls, permission mode, and stop/send action.
- Optional contextual panels for files, diff review, terminal, plan, and settings.
- A command palette and keyboard shortcuts for important actions.

Web and desktop render the same application. Desktop-only behavior is supplied through a typed bridge,
not detected throughout Vue components.

### 6.2 Agent map

The map is a full work surface, not a small decorative diagram.

Each node represents an agent session or a native provider subagent task. Tool calls do not become
separate graph nodes in the MVP; they remain activity inside the owning node.

A node displays:

- User-facing name or task summary.
- Provider and model when known.
- State: starting, running, waiting, needs input, completed, interrupted, or failed.
- Current activity summary.
- Child count and pending approval indicator.
- Changed-file count when attributable.

An edge means “spawned by.” Edge direction goes from parent to child. Graph layout is deterministic
for identical data but users may reposition nodes locally. Saved positions are presentation state and
must not affect the agent hierarchy.

Map interactions:

- Pan, zoom, fit view, minimap, and reset layout.
- Filter by state or provider.
- Select a node to inspect a compact activity panel.
- Open a node's full transcript when the provider exposes one.
- Jump to a node that needs approval or input.
- Return to the previously selected conversation without losing scroll or composer state.

The same hierarchy is available as a keyboard-operable tree/list view. The canvas is an enhancement,
not the only way to discover or navigate agents.

The first map is observational. Agent spawning, steering, stopping, and closing continue through the
conversation/provider controls. Direct manipulation can be added only after the provider capability
model supports it honestly.

### 6.3 Customization

The MVP supports:

- Light, dark, and system theme.
- Design tokens for color, spacing, typography, radius, and motion.
- Resizable and hideable panels.
- Persisted panel arrangement.
- Keyboard shortcut customization.
- Graph node density and status-color preferences.
- Per-provider defaults for model, effort, and permission mode.

Customization is stored as validated settings. Vue components consume semantic tokens and settings;
they must not read arbitrary persisted JSON.

## 7. Functional requirements

### 7.1 Environments and connectivity

- The Nitro server runs with a Node preset because it owns subprocesses and local resources.
- Electron starts Nitro in a supervised child or utility process, waits for an authenticated
  readiness message, and then loads the server's loopback origin. The Effect runtime is created once
  for that server lifetime and closed from server shutdown hooks.
- Desktop uses a single-instance owner, a dynamic loopback port, a bounded crash-restart policy, and
  graceful shutdown followed by bounded force termination of processes it started.
- The browser can connect to an existing server using the same public contract.
- Local connections use same-origin HTTP and WebSocket paths in development and production.
- Remote/trusted-network access uses short-lived pairing followed by revocable environment sessions.
- Secrets never cross to the client after configuration.
- The MVP represents one server environment. Its projects and paths are server-local. A remote browser
  uses a server-side repository browser; it cannot send a client-machine folder selection.

### 7.2 Projects

- Add a project from an absolute local directory.
- On desktop, open the native folder picker immediately and register a valid selection without a
  redundant confirmation form. The browser surface uses a constrained server-side directory browser.
- Validate that the directory exists and detect its Git repository when present.
- Accept non-Git directories while visibly disabling Git-dependent checkpoint and review actions.
- List, rename, reorder, hide, and remove project records without deleting source files.
- Show Git branch and working-tree status.
- Preserve multiple projects independently.

### 7.3 ACP providers

- Launch lockfile-resolved adapter executables with argument arrays and `shell: false`; never execute
  floating `npx -y` packages at runtime.
- Initialize with ACP protocol version 1, client implementation information, and only client
  capabilities MetaClanker fully implements. Close with a visible incompatibility error if the
  negotiated version is not supported.
- Treat the capability snapshot as immutable for one process connection and discard it after exit.
  Absent or null optional capabilities mean unsupported; unknown future fields do not break decoding.
- Derive model, effort, fast-mode, permission, and other controls from session modes and config
  options, including dynamic updates, instead of hardcoding provider-specific pickers.
- A local draft never opens a provider session for catalog discovery. After a real session opens,
  persist its currently advertised model identifiers as a replaceable provider-scoped cache. The
  draft model catalog combines that cache with local recent/custom values and labels an empty cache
  honestly; it does not imply that a provider supports an unadvertised model. Opening the catalog
  refreshes readiness metadata so models learned by an earlier turn become available without an app
  restart.
- Require pre-existing local provider authentication for the MVP. Do not inspect credential files.
  Derive `unknown`, `ready`, or `authentication-required` from operations and advertised auth flows.
- Display advertised authentication methods. Agent-handled methods and terminal authentication are
  distinct; unstable Claude terminal-auth support stays disabled unless its pinned compatibility
  extension is explicitly enabled.
- Start optional list, resume, load, close, delete, logout, and configuration operations only when
  their exact capabilities allow them. Baseline prompt, update, and cancel behavior is always
  implemented.
- Advertise filesystem, terminal, elicitation, and boolean-config client capabilities only after
  their handlers enforce project scope, lifetime, and exactly-once response rules.
- Treat EOF, invalid or oversized framing, protocol mismatch, and unexpected exit as connection
  failure. Reject pending RPCs, expire live interactions, and mark the root session disconnected.
- Capture stdout exclusively as newline-delimited ACP. Stderr diagnostics are separately bounded and
  redacted.

### 7.4 Drafts, threads, and turns

- Keep at most one unsent local draft per project. Drafts preserve prompt, attachments, cursor, provider,
  model, effort, and permission settings across navigation and local restart without server transmission.
- Create the durable thread and initial turn together on first send under one stable command ID. Persist
  the title, user message, intent, events, projections, and receipt atomically before ACP dispatch.
- Replaying the same accepted first-send command returns the original thread and never redispatches it.
- Stream user messages, agent messages, thought summaries, plans, tool calls, and usage information.
- Send follow-ups and attachments supported by the negotiated prompt capabilities.
- Interrupt an active prompt. Sending ACP cancel moves the turn to `cancelling`; it becomes
  `cancelled` only when the outstanding prompt resolves with that stop reason. Ordered updates may
  still arrive before completion.
- Prefer `session/resume` after restart because it restores provider context without replay. If only
  `session/load` is supported, collect its pre-response updates in a separate replay epoch and
  reconcile that epoch atomically; never append replay updates blindly or assume message IDs exist.
- Persist the exact working directory, MCP configuration, and additional directories needed to
  resume or load a provider session.
- If neither resume nor load is available, preserve the local transcript as readable and mark the
  thread non-continuable.
- Archive, unarchive, rename, and delete local thread records.
- Keep local deletion, provider close, and provider-history deletion as distinct confirmed actions.
  Provider close frees active resources but preserves history. Provider delete means removal from
  future provider session listings; no stronger destruction semantics are assumed without an
  adapter-specific guarantee.
- Represent active, waiting, completed, interrupted, cancelled, and failed states accurately.
- Never automatically resend an uncertain in-flight prompt after process loss. A formerly running
  turn becomes `recovery-required` or `interrupted`, and the user chooses the next action.

### 7.5 Permissions and elicitation

- Render every ACP permission option supplied by the agent.
- Associate a request with its owning project, thread, turn, and graph node.
- Support allow/reject outcomes and cancellation.
- Render structured elicitation when negotiated.
- Tie each responder to its originating live process and request ID. Respond at most once; connection
  loss marks persisted permission or elicitation UI as `stale`, never actionable.
- Never automatically approve destructive actions unless an explicit stored policy allows that exact
  category and scope.

### 7.6 Tool calls and terminals

- Show tool title, kind, lifecycle state, content, locations, and available raw diagnostics.
- Display terminal output incrementally and preserve the final output.
- Allow stopping supported running terminals.
- Bound in-memory terminal buffers and persist a useful replay without storing unlimited output.
- Scope client-owned terminal processes to the root session and terminate them when that session
  closes. Adapter-native terminal metadata remains distinct from standard ACP client terminals.

### 7.7 Git checkpoints and review

- Capture a pre-turn checkpoint before every prompt dispatch and a post-turn checkpoint after provider
  work settles. The pre-turn snapshot cannot depend on knowing whether the future turn will modify
  files.
- Derive changed files and diffs from checkpoints rather than trusting provider summaries.
- Review additions, modifications, deletions, and untracked files.
- Define turn diffs against the captured snapshots and label concurrent user edits honestly; the MVP
  does not claim it can attribute every change to one agent.
- Call the ACP-v1 operation “Restore files.” Provider conversation rewind is separate and available
  only through a proven capability. Without it, restoration leaves the transcript unchanged and the
  UI recommends continuing in a new session.
- Restore files only while the root session is idle, after showing a destructive preview and capturing
  an undo checkpoint. The preview explicitly covers tracked, staged, untracked, and ignored files.
- Checkpoint refs are implementation details and do not modify the user's visible branch history.
- Never operate against non-project paths.

### 7.8 Persistence and recovery

- SQLite is authoritative for MetaClanker projects, UI history, commands, graph state, and
  projections. The provider remains authoritative for resumable model context. Recovery reconciles
  those authorities rather than claiming they are identical.
- Persist normalized events before publishing their durable effects to subscribers.
- Maintain projections for fast project, thread, transcript, approval, and graph reads.
- Rebuild projections from the event log in tests and recovery tooling.
- Store canonical decoded events in SQLite. Raw provider envelopes are disabled by default and, when
  diagnostics are explicitly enabled, go to a separate redacted, rotating store with age and size
  limits. UI models never depend on raw payloads.
- Version persisted events and define upcasters for supported historical versions.
- Run versioned, transactional migrations.
- Use a dedicated application-data directory and a separate temporary test directory.
- Support consistent SQLite backup and restore without copying a live database file unsafely.

## 8. System architecture

```text
┌────────────────────────────────────────────────────────────┐
│ apps/web: Vue 3 + Vite                                    │
│ conversation UI, review UI, Vue Flow map                  │
└─────────────────────────┬──────────────────────────────────┘
                          │ Effect Schema HTTP/WebSocket contract
┌─────────────────────────▼──────────────────────────────────┐
│ apps/server: Nitro Node server + Effect runtime           │
│ auth, orchestration, subscriptions, Git, terminal, files  │
└───────────────┬───────────────────────┬────────────────────┘
                │                       │
       ┌────────▼────────┐     ┌────────▼────────┐
       │ Effect SQL      │     │ ACP supervisor │
       │ SQLite          │     │ stdio JSON-RPC │
       └─────────────────┘     └───────┬─────────┘
                                      │
                           ┌──────────┴──────────┐
                           │                     │
                    codex-acp             claude-agent-acp
                           │                     │
                        Codex                  Claude

apps/desktop: Electron shell → starts server and hosts apps/web
```

### 8.1 Workspace layout

```text
apps/
  web/          Vue application
  server/       Nitro entry points and composition root
  desktop/      Electron main process, preload, and packaging
packages/
  contracts/    Public Effect Schema HTTP/WebSocket contracts only
  application/  Commands, use cases, and domain ports
  domain/       Internal events, pure state transitions, projections, and policies
  acp-client/   ACP process, connection, capability, and session runtime
  persistence/  Effect SQL repositories and migrations
  git/          Git checkpoint and diff operations
  testing/      Fake ACP agent, builders, fixtures, and test runtime layers
```

Packages expose explicit subpath APIs. Root barrel exports are prohibited for internal packages.
Shared Vue components and tokens remain in `apps/web` until a second real consumer justifies a deep
`packages/ui` contract.

### 8.2 Dependency direction

```text
web → public contracts/client
Nitro HTTP/WebSocket → application use cases → domain ports
server composition root → persistence/Git/ACP implementations
desktop preload → narrow desktop bridge contract
```

Only the server composition root imports concrete persistence, Git, and ACP implementations. Public
transport schemas and internal persisted-event schemas are separate versioned surfaces.

Within `apps/web`:

```text
views → features → shared UI/composables
```

Features do not import from other features. Views coordinate multiple features. Shared modules cannot
import from features or views. ESLint enforces these boundaries.

### 8.3 Deep public contracts

The exact syntax may evolve, but the conceptual interfaces remain narrow. Branded IDs prevent
accidental routing across adapters, sessions, turns, and live interactions.

```ts
interface AcpSessions {
  open(input: OpenAcpSessionInput): Effect.Effect<SessionHandle, OpenSessionError, Scope.Scope>
}

interface SessionHandle {
  capabilities: SessionCapabilities
  events: Stream.Stream<NormalizedAgentEvent, AcpRuntimeError>
  prompt(input: PromptInput): Effect.Effect<PromptOutcome, PromptError>
  requestCancel(): Effect.Effect<void, TransportError>
}

interface PendingInteraction {
  id: PendingInteractionId
  sessionId: SessionId
  kind: "permission" | "elicitation"
  respond(input: InteractionResponse): Effect.Effect<void, InteractionExpiredError>
}

const reduceAgentGraph: (
  state: AgentGraphSnapshot,
  event: NormalizedAgentEvent,
) => AgentGraphSnapshot

interface Checkpoints {
  capture(input: CaptureInput): Effect.Effect<Checkpoint, CheckpointError>
  diff(input: DiffInput): Effect.Effect<WorkspaceDiff, CheckpointError>
  restore(input: RestoreInput): Effect.Effect<void, CheckpointError>
}
```

Callers do not manage JSON-RPC request IDs, child-process pipes, reconnection order, SQLite
transactions, Git plumbing, or projection sequencing. Scoped finalizers own session close, stdin
closure, grace periods, process-group termination, and forced termination. The session module
serializes ordinary prompts and owns cancellation completion; active steering or prompt queueing is
available only through an exact advertised extension.

The supervisor state machine is explicit:

```text
stopped → starting → initializing → ready → stopping → stopped
                ↘ failed/disconnected ↗
```

Every transition is observable and tested. Process loss expires live interaction responders and
cannot leave a session appearing active indefinitely.

### 8.4 Durable command and side-effect flow

Every client mutation carries a stable `commandId`. Commands are serialized per affected thread or
project aggregate. A pure decider returns accepted domain events or a typed rejection. In one SQLite
transaction, the server appends events, updates projections, and stores the accepted or rejected
command receipt. Retrying the same `commandId` returns that receipt without repeating work.

ACP, Git, and terminal actions run after commit from durable intent records with
`pending`, `running`, `succeeded`, `failed`, or `uncertain` state. Reactors are queue-backed and
drainable in tests. Completion or failure returns through internal commands and events.

A crash between durable intent and side-effect completion is reconciled by effect type. Read-only and
idempotent effects may retry. An uncertain prompt dispatch or destructive restore is never retried
blindly because it may duplicate external or filesystem effects.

### 8.5 Normalized event model

All external data is decoded with Effect Schema at the boundary. The normalized event union includes:

- environment connected/disconnected.
- adapter started/exited.
- session created/loaded/status changed.
- turn started/completed.
- user/agent/thought message chunks.
- plan replaced or updated.
- tool call started/updated/completed.
- permission or elicitation requested/resolved.
- terminal created/output/exited.
- usage updated.
- native subagent discovered/status changed.
- checkpoint captured/diff completed.
- runtime failure recorded.

Each event has a schema version, globally monotonic sequence, MetaClanker event ID, server receipt
time, project ID, thread ID when applicable, origin, and provider references. Reducers and projectors
are pure and exhaustive over this union.

### 8.6 Subagent normalization

ACP v1 does not standardize subagent hierarchy. The adapters currently expose namespaced metadata:

- Codex uses `_meta.codex.subagent` for thread identity, best-effort path, and
  `started`, `interacted`, or `interrupted` activity.
- MetaClanker advertises `clientCapabilities._meta["subagent-transcript"] = true` to the pinned Claude
  adapter. Claude marks Agent/Task launch calls with `_meta.claudeCode.subagent = true` and relates
  nested updates with `_meta.claudeCode.parentToolUseId`.

Claude node identity is the root session plus launching tool-call ID; its transcript is a filtered
nested view of the root session. Codex node identity is the root session plus subagent thread ID;
activity tool-call IDs are events, not graph-node IDs. Only `packages/acp-client` interprets these
versioned metadata decoders and emits provider-neutral graph events. Missing launch metadata creates
unattributed activity rather than an invented edge. If metadata changes, chat continues and the graph
capability is reported as degraded.

### 8.7 Effect usage

Effect owns resource safety and concurrency in backend packages:

- `Scope` for adapter processes, streams, database connections, and terminals.
- `Queue` and `Stream` for ordered runtime ingestion.
- typed domain errors rather than thrown exceptions.
- `Layer` for live and test implementations.
- schedules for bounded retry and reconnection.
- interruption for cancellation and shutdown.
- tracing spans around requests, turns, tools, database transactions, and checkpoints.

Vue components do not execute Effect programs directly. Application services expose a client-facing
contract and Vue consumes already-decoded state.

### 8.8 Persistence model

Initial tables:

- `environments`
- `projects`
- `provider_adapters`
- `provider_models` (replaceable ACP-advertised metadata, not conversation authority)
- `threads`
- `turns`
- `command_receipts`
- `side_effect_intents`
- `events`
- `messages`
- `tool_calls`
- `pending_requests`
- `agent_nodes`
- `agent_edges`
- `checkpoints`
- `settings`
- `schema_migrations`

The append-only event table and current-state projections share a transaction. Large binary
attachments and unbounded terminal output are stored outside primary rows with explicit retention
limits. Online backups use a SQLite-supported consistent snapshot operation such as `VACUUM INTO`;
the application never backs up only the main file of a live WAL database.

### 8.9 Client synchronization protocol

Durable subscriptions use at-least-once delivery and idempotent client application:

1. The client requests a shell or thread-detail subscription with its last applied sequence.
2. The server attaches a bounded live buffer before reading a transactional snapshot and its
   `snapshotSequence`.
3. The server replays events through a captured head, then drains overlapping buffered events while
   deduplicating by sequence.
4. A `synchronized` marker declares the point at which delivery is live.
5. Reconnect resumes with `afterSequence`. Invalid or excessively old cursors, schema mismatch, or
   queue overflow require a fresh snapshot.

WebSocket upgrades authenticate a short-lived ticket. Heartbeats detect dead peers, reconnect uses
bounded exponential backoff with jitter, and every operation still checks its read, operate, or
terminal authorization scope. Long-lived bearer credentials do not appear in URLs.

### 8.10 Desktop runtime boundary

Electron loads the built Vue application from the authenticated Nitro loopback origin. The renderer
has `nodeIntegration: false`, `contextIsolation: true`, sandboxing enabled, a strict CSP, navigation
and new-window allowlists, explicit permission handlers, and hardened Electron fuses. The preload
exposes individual typed operations rather than raw IPC primitives, and the main process validates
the sender of every privileged call.

Presentation preferences that must survive Electron's dynamic loopback ports use that same typed
bridge and a mode-0600 file in the application-data directory. The browser surface keeps its
same-origin `localStorage` fallback; the bridge never exposes a general filesystem or key-value API.

Unsent conversation drafts require the same cross-origin continuity but are not presentation
preferences. Electron therefore stores their already-schema-shaped JSON in a separate mode-0600
application-data file through dedicated read/write bridge operations. The main process validates the
sender, JSON object shape, and a bounded payload size; the renderer still performs the authoritative
Effect Schema decode. Writes are serialized and flushed during shutdown. Draft content is never
placed in process arguments, logs, errors, or a generic storage API, and browser-only deployments
retain the same-origin `localStorage` implementation.

The packaged server must load the native SQLite driver on each supported OS and architecture. A
Milestone 0 spike verifies native-module ABI, bundling/unpacking, application-data paths, readiness,
crash limits, and cleanup before feature work depends on the desktop topology.

## 9. Frontend architecture

### 9.1 Selected stack

- Vue 3 with `<script setup>` and strict TypeScript.
- Vite as the frontend development/build compatibility contract.
- A pinned Vite+ beta may provide workspace tasks, formatting, linting, and tests only after the
  Milestone 0 compatibility spike. Do not maintain duplicate configuration sources; `vue-tsc`
  remains an explicit gate until the selected toolchain fully covers Vue SFC checking.
- Vue Router for named routes.
- Effect Atom for shared asynchronous, keyed, cached, or resource-owning client state, with one
  explicit registry and fresh runtime memo map per app mount. Pinia remains only as a transitional
  owner for unmigrated slices; no writable slice is authoritative in both systems.
- Vue Flow for the map.
- Tailwind CSS using semantic design tokens.
- Reka UI primitives for accessible behavior.
- A sanitized Markdown renderer.

### 9.2 Vue rules

- Components render state and emit user intent; domain decisions live in pure modules.
- SFCs consume project-owned `use*Model` composables that return Vue refs and named intents. Atom
  definitions, Effects, Layers, Streams, runtime construction, raw Causes, and registry access stay
  outside `.vue` files; UI primitives import none of the client model.
- A `use*.ts` module must use Vue reactivity or a store. Otherwise it is a utility and is named as
  such.
- Prefer Vue 3.5 APIs, including template refs and explicit component APIs.
- No direct DOM queries in feature code when a Vue template ref or component API is appropriate.
- Keep template nesting shallow and extract meaningful components.
- Components and files use consistent PascalCase names.
- Route navigation uses route names, not duplicated path strings.
- No hardcoded design-system colors in component templates.
- User-facing strings go through a message catalog even if the MVP initially ships only English.
- Views are explicit feature-composition points. Shared extraction requires multiple consumers or a
  stable domain concept; `shared` must not become a dumping ground for cross-feature logic.

### 9.3 Accessibility requirements

WCAG 2.2 AA is the engineering target even though MetaClanker is private. Automated axe checks are a
floor, not proof of accessibility.

- The agent map has an equivalent hierarchical tree/list view with conventional keyboard navigation.
- Focus is restored predictably between transcript, map, dialogs, composer, and resizable panels.
- Every drag or resize action has a non-drag alternative.
- Status is never conveyed only by color; light and dark themes meet contrast requirements.
- Reduced-motion preferences disable nonessential graph and panel animation.
- Streaming updates announce meaningful completed messages or state changes, never every token.
- Diff and terminal surfaces expose usable names, reading order, and keyboard controls.
- The MVP release includes manual keyboard and screen-reader spot checks of critical journeys.

## 10. Testing strategy

The strategy follows the Testing Trophy: static analysis forms the base, most confidence comes from
integration tests, focused units cover combinatorial domain rules, and a very small E2E layer proves
the deployed topology. The goal is confidence per maintenance cost, not test count or coverage
percentage. Tests should resemble how the software is used.

Each behavior has one primary owner at the cheapest layer that still exercises the real behavior:

| Layer | Primary ownership |
| --- | --- |
| Static and type contracts | syntax, types, architecture, public compile-time contracts |
| Node unit/property | pure rules, reducers, policies, normalization, state-machine invariants |
| ACP contract | framing, capabilities, protocol ordering, adapter compatibility |
| Backend integration | Effect services with real temporary SQLite, Git, filesystem, and ACP stdio |
| Browser integration | user-visible Vue behavior with real components, router, the real app-scoped client model, and browser APIs |
| Playwright E2E | a few critical journeys through production web and server processes |
| Packaging smoke | Electron artifact startup, preload boundary, native ABI, and shutdown |

Higher layers prove representative collaboration and topology; they do not repeat every lower-layer
edge case. A bug fix begins with a failing regression test at the lowest layer that reproduces the
public symptom.

### 10.1 Test project topology

Use the current Vitest `test.projects` configuration with unique project names:

- `node-unit`: `**/*.unit.test.ts` in the Node environment for pure TypeScript domain tests.
- `node-contract`: `**/*.contract.test.ts` in Node for schemas, HTTP/WebSocket contracts, and ACP.
- `node-integration`: `**/*.integration.test.ts` in Node for Effect-backed server integration.
- `browser-ui`: `**/*.browser.test.ts` in real Chromium through Vitest Browser Mode and
  `@vitest/browser-playwright`.

Normal `tsc -b` plus `vue-tsc --noEmit` remains the authoritative type gate. A separate
`type-contracts` lane owns `**/*.test-d.ts` as soon as the first public compile-time contract exists;
Vitest typecheck support must not replace the compiler gate while it remains experimental.
Playwright production E2E and Electron packaging smoke remain separate from Vitest. File suffixes and
include patterns make it impossible for a test to silently run in the wrong environment.

Colocate behavior tests with their owning code. Centralize only reusable harnesses, builders,
boundary fakes, and redaction utilities in `packages/testing`; do not centralize mutable test state.
The initial harness layout is:

```text
packages/testing/src/
  acp/          fake agent entrypoint, scenarios, recordings, redaction
  msw/          shared handlers plus Node, browser, and WebSocket setup
  vue/          renderComponent, renderFeature, createTestApp
  fixtures/     builders, temporary project, Git repository, and database
tests/setup/    environment-specific global setup only
```

The ACP fake is a real deterministic executable launched through the production supervisor with an
argv array and `shell: false`. Scenario configuration can produce capability variants, permissions,
elicitation, partial or malformed frames, bursts, and exact crash points. It advances only after
observed protocol actions; control data never contaminates ACP stdout.

### 10.2 Node unit and property tests

Use Node Vitest for meaningful decisions in pure deterministic modules:

- graph reducers and deterministic layout inputs.
- state machines, event reducers, and status derivation.
- message and tool-call assembly and normalization.
- permission, path, checkpoint, and replay/idempotency policies.
- schema migrations expressed as pure transformations.

Use `@fast-check/vitest` where generated inputs or operation sequences give materially more
confidence: event ordering, chunk assembly, path containment, command idempotency, graph invariants,
and settings migration. State-machine models must be simpler than the production implementation.
Failure output preserves the seed and replay path so every counterexample is reproducible.

Do not unit-test trivial getters, pass-through wrappers, constructors, Vue refs/watchers, or isolated
client-state actions by default. A model receives a unit test only when it exposes a genuinely
framework-independent domain algorithm; normal store/router/composable collaboration belongs in a
rendered feature test.

### 10.3 ACP contract tests

Create a deterministic fake ACP agent in `packages/testing` that communicates over real stdio framing.
Run the MetaClanker ACP client against it to verify:

- initialization and capability negotiation.
- authentication method handling.
- protocol-version mismatch and omitted, null, empty, unknown, or newly added capabilities.
- prompt streaming and stop reasons.
- permissions and elicitation.
- cancellation and process exit.
- concurrent isolated root-session processes without event or response cross-routing.
- malformed JSON-RPC and unexpected messages.
- backpressure and bounded buffers.
- session load/resume capability differences.
- resume without replay, load as a complete replay epoch, and replay without message IDs.
- generic operation without subagent extensions.
- Codex and Claude subagent metadata fixtures.
- Claude behavior with and without nested-transcript opt-in and nested tool calls.
- Codex `started`, `interacted`, and `interrupted` subagent activity.
- inbound interactions arriving before the originating request completes.
- process crash before prompt dispatch, mid-tool, while awaiting permission, and after uncertain side
  effects.
- responder expiry after disconnect and unknown-session updates.
- stdout junk, malformed or partial JSON, oversized unterminated lines, and stderr flooding.

Keep sanitized, versioned protocol recordings for adapter compatibility tests. Raw recordings may
enter fixtures only after secrets and local paths are removed.

### 10.4 Backend integration tests

Use real temporary directories, temporary Git repositories, and a temporary SQLite database to test:

- normalized event ingestion through transaction and projection.
- crash before and after event/receipt commit and retry with the same `commandId`.
- restart and replay recovery.
- stale approval recovery and uncertain prompt reconciliation.
- migrations from every supported schema version.
- Git checkpoint capture, diff, and restore.
- restore preview, undo checkpoint, and failed checkpoint after provider completion.
- server subscription catch-up without gaps or duplicates.
- snapshot/live races, slow-subscriber overflow, and required snapshot resynchronization.
- pairing, authorization, and revoked sessions.
- graceful shutdown of adapters and terminals.

Asynchronous tests wait on typed receipts, stream events, or drainable workers. Arbitrary sleeps and
poll-until-timeout loops are prohibited.

### 10.5 Browser feature integration and MSW

Browser integration is the default layer for user-visible behavior. Use Vitest Browser Mode with
real Chromium, `vitest-browser-vue` for rendering, and `page` plus `userEvent` from `vitest/browser`.
Rendering and interactions are awaited; assertions use retrying `expect.element`. Query by role and
accessible name first, then label or visible text. Test IDs are reserved for non-semantic data with
no accessible representation.

`renderFeature` and `createTestApp` are the normal helpers. They render real parent/child Vue
components, the app-scoped client model, router, message catalog, design tokens, and domain code. `renderComponent` is
exceptional and limited to reusable interactive primitives or genuinely complex leaf widgets.
Tests must not mock child components, stores, composables, the router, or internal application
services.

MSW is the standard network-boundary fake:

- browser integration uses `msw/browser` for HTTP and WebSocket scenarios.
- Node network-client integration uses `msw/node`.
- default handlers describe one minimal valid server; a test overrides only its scenario.
- unhandled MetaClanker API requests are errors, intentional static or third-party traffic is
  explicitly bypassed, and handlers reset after every test.
- handlers and response builders consume shared wire schemas so fixtures cannot silently drift.
- handlers are stateless; every stateful stream or reconnect scenario is created per test.
- MSW replaces transport, never domain services. It does not fake Nitro internals, SQLite, Git, or
  ACP; backend tests use the real boundaries described above.

Primary browser coverage includes:

- transcript streaming and scroll anchoring.
- permission and elicitation interactions.
- composer states and keyboard behavior.
- diff and terminal panels.
- project/thread navigation.
- map selection, filters, fit-view, and keyboard navigation.
- equivalent map tree/list navigation and focus restoration.
- status representation without color as the only signal.
- reconnect and stale-state presentation.

Map filtering, selection, the accessible tree alternative, and transcript return are owned here, not
duplicated in E2E. Run `axe-core` checks for shared interactive primitives and primary composed
views, while keyboard, focus, and semantic-locator assertions provide the stronger accessibility
signal.

The following are prohibited in browser tests: Vue Test Utils `wrapper.vm`, direct emitted-event
arrays, `.trigger`, synthetic `fireEvent`, jsdom/happy-dom, CSS or XPath selectors, DOM-shape and
class assertions, whole-DOM snapshots, and manual polling. If a control cannot be found semantically,
fix its accessibility instead of adding a test-only selector.

### 10.6 End-to-end tests

Playwright runs against production builds with the deterministic fake ACP adapter. Keep the PR suite
small and use role-based locators plus web-first assertions:

1. Add project → create Codex-like thread → stream work → approve tool → review diff.
2. Restore persisted application → resume thread → interrupt a turn.

These journeys use real Nitro, WebSocket transport, SQLite, Git, and the fake ACP process. They do not
use MSW. E2E fixtures fail on unexpected page errors, unhandled promise rejections, console errors,
CSP violations, unexpected API requests, and accessibility violations in the critical path.

### 10.7 Type-contract tests

Use `*.test-d.ts` and `expectTypeOf` only where compile-time failure is intentional:

- branded identifiers cannot be interchanged.
- command, event, and error unions remain discriminated and exhaustive.
- the Electron preload bridge exposes only its public typed surface.
- public package APIs and Vue component props, slots, and emits retain their promised shape.

Runtime schemas still require runtime decode tests. Do not type-test inferred internals or reproduce
checks already guaranteed by ordinary TypeScript and `vue-tsc`.

### 10.8 Targeted mutation testing

Use StrykerJS with the Vitest runner to audit whether tests detect meaningful changes in high-risk
pure modules: permission and path policies, event/state reducers, command idempotency and replay
decisions, protocol normalizers, and graph projection. Stryker's Vitest runner is Node-only, so
Browser Mode tests are not mutation inputs.

Do not mutate Vue templates, generated code, migrations, adapters, Effect wiring, or
integration-heavy glue. Establish a reviewed baseline before setting thresholds, then ratchet
targeted module thresholds without turning a repository-wide score into the objective. Surviving
mutants are triaged as a missing assertion, equivalent mutant, or unreachable code; broad exclusions
and blind test generation are not acceptable fixes. Run changed-scope checks on demand and the full
targeted set on a schedule rather than blocking every ordinary commit.

### 10.9 Prompt and model evaluation

MetaClanker tests prompts only when MetaClanker owns them. Deterministic tests verify prompt assembly,
required semantic sections, variables, escaping, and safety constraints without brittle full-string
snapshots. Provider-owned Codex and Claude prompts are out of scope.

If the product later owns model-dependent behavior such as titles, recovery explanations, or
orchestration advice, keep a small versioned scenario corpus with human-reviewed expectations.
Live-model evaluations use pinned provider/model settings in an opt-in or scheduled job, never gate
ordinary pull requests, and never rely on an LLM judge as the sole acceptance signal.

### 10.10 Real-provider tests

Authenticated tests against pinned `codex-acp` and `claude-agent-acp` are opt-in locally and run in a
separate protected or scheduled CI job when credentials are available. They verify a minimal
capability matrix and sanitized event shape. They never gate ordinary pull requests because provider
availability, authentication, and model behavior are external variables.

### 10.11 Smoke and packaging tests

- Build web, Nitro server, and Electron artifacts in CI.
- Verify the Electron preload exposes only the declared bridge.
- Launch the packaged application in a temporary profile.
- Verify server readiness, static assets, native SQLite loading, database creation, crash-loop bounds,
  and clean shutdown.
- Complete one minimal packaged-Electron launch and prompt smoke. Playwright Electron automation is
  treated as experimental and does not duplicate the production-web or browser-feature suites.
- Never read or write the user's real MetaClanker, Codex, Claude, or Git state during tests.

### 10.12 Test integrity, fixtures, and flake policy

- Test names describe user or domain outcomes, not function names, lifecycle hooks, or implementation
  steps. Prefer a few cohesive flows over fragmented nested `describe` trees.
- Test doubles exist only at external or nondeterministic boundaries: provider processes, network,
  time/random/UUID, OS dialogs, and secure storage. Prefer stateful fakes over interaction-heavy
  mocks; do not assert call counts when a visible or durable result proves the outcome.
- Builders create minimal valid states with explicit overrides. Giant shared fixtures, cross-test
  mutation, and dependence on execution order are prohibited.
- Every test or worker owns a unique temporary application-data directory, database, repository,
  project, port, and ACP process. Cleanup asserts that no child process, terminal, socket, database
  handle, MSW override, or listener leaked.
- Snapshots are limited to compact, stable, human-reviewed protocol or schema serialization. Never
  snapshot a whole DOM, class list, prompt, diff, or event log.
- Arbitrary sleeps, `waitForTimeout`, `networkidle`, unbounded polling, and retry-to-green policies are
  prohibited. Await role-visible state, typed receipts, readiness, stream cursors, or drainable
  workers instead.
- Retries are zero in the authoritative PR run. Traces and videos are retained on failure, while a
  pass on infrastructure rerun remains reported as a flaky defect. Scheduled jobs repeat critical
  journeys with a reported seed to detect flakes.
- A quarantined test requires an owner, linked issue, expiry date, and replacement confidence
  mechanism. CI fails on `test.only`, unexplained skips, unhandled rejections, and leaked resources.
- AI-authored changes may not weaken or delete assertions, fixtures, mutation thresholds, lint rules,
  or acceptance tests merely to obtain a green run. Any such change requires explicit justification
  in review. Tests and implementation are reviewed as separate logical changes.

## 11. Quality pipeline

### 11.1 Tooling

- pnpm 11+ pinned in `packageManager`, with a committed lockfile and workspace catalog for shared
  versions.
- Vite+ only where the Milestone 0 compatibility decision assigns it ownership.
- Oxfmt for formatting.
- Oxlint first for fast general feedback.
- ESLint second for Vue, accessibility, Vitest, imports, and local architectural rules.
- strict TypeScript and `vue-tsc`/equivalent template checking.
- Vitest, Vitest Browser Mode, and Playwright.
- `vitest-browser-vue`, `@vitest/browser-playwright`, MSW, and `@fast-check/vitest` for the owned test
  boundaries defined above.
- StrykerJS with the Vitest runner for scheduled targeted mutation testing.
- Knip once the initial package graph exists.
- Lefthook for staged-file checks.

Dependencies are pinned through the lockfile. ACP adapter upgrades are explicit compatibility changes,
not automatic floating updates.

Repository supply-chain defaults:

- `minimumReleaseAge: 1440` with strict enforcement and reviewed exceptions.
- `blockExoticSubdeps: true`.
- An explicit pnpm `allowBuilds` list; native SQLite build scripts are allowed only after review.
- Consider `trustPolicy: no-downgrade` when supported by the pinned pnpm release.
- Gitleaks on every pull request; OSV scanning on lockfile changes and nightly.
- Grouped, scheduled Renovate updates.
- Release SBOM generation.
- GitHub Actions pinned to full commit SHAs with least-privilege token permissions.

### 11.2 Enforced code rules

- No explicit `any`.
- No unsafe type assertions; use decoding, narrowing, or type guards. `as const` is allowed.
- No TypeScript enums; use literal unions or const objects.
- No nested ternaries.
- Prefer early returns over `else` chains.
- Warn when cyclomatic complexity exceeds 10.
- Extract complex conditions into named domain predicates.
- No floating promises.
- No cross-feature imports.
- No unrestricted root package barrels.
- No direct native `try/catch` inside Effect backend packages; translate external failures with Effect
  constructors and typed errors. Non-Effect frontend failure-producing boundaries may use the shared
  Result helper; do not wrap infallible or trivial promises merely to satisfy a pattern.
- No arbitrary time-based waits in tests.
- No mutable state shared across test cases.
- Tests use specific Vitest matchers and role-based browser locators.
- No internal Vue mocks, child stubs, CSS/DOM selectors, raw event dispatch, wrapper-internal
  assertions, or unreviewed broad snapshots.
- Unexpected MSW requests, browser console/page errors, unhandled rejections, leaked handles,
  committed `test.only`, and unexplained skipped tests fail CI.
- Lint-rule disables require a narrow explanation and cannot bypass architecture, type-safety,
  accessibility, or message-catalog rules.

Local ESLint rules should be added only when an important convention cannot be expressed reliably by
an existing maintained rule.

### 11.3 Feedback stages

Editor:

- TypeScript/Vue language service.
- Oxlint and ESLint diagnostics.
- targeted Vitest watch.

Canonical test commands:

- `pnpm test:unit` — `node-unit`.
- `pnpm test:contract` — `node-contract`.
- `pnpm test:integration` — `node-integration`.
- `pnpm test:browser` — headless Chromium `browser-ui`.
- `pnpm test:types` — `tsc -b`, `vue-tsc --noEmit`, and deliberate type-contract tests.
- `pnpm test:e2e:web` — production web/Nitro journeys.
- `pnpm test:e2e:desktop` — the minimal Electron topology journey.
- `pnpm test:smoke:package` — packaged-artifact verification.
- `pnpm test:mutation` — targeted Stryker scope, normally scheduled or explicit.

Pre-commit, changed files only:

- format.
- Oxlint.
- ESLint.
- targeted unit tests when mapping is reliable.

Pull-request CI:

- install with frozen lockfile.
- format check.
- full Oxlint and ESLint.
- typecheck.
- Node unit, property, wire-schema, and ACP contract tests.
- backend integration tests with isolated SQLite, Git, filesystem, Nitro, and real WebSocket clients.
- Chromium browser feature integration with MSW at the client transport boundary.
- production builds for web, server, and desktop.
- the two-journey fake-provider production-web Playwright suite.
- one-platform packaged desktop smoke.

Scheduled/protected CI:

- real-provider compatibility smoke tests.
- full cross-platform Electron packaging matrix.
- dependency and vulnerability review.
- targeted mutation tests and shuffled/repeated flake detection with reported seeds.
- property suites at their extended run count.
- larger accessibility and performance audits.
- cross-browser feature checks where browser differences are material.
- visual regression after the design system stabilizes.

Jobs are split so failures identify the responsible layer. CI cancels stale runs on the same branch.

### 11.4 Coverage policy

Do not optimize for a repository-wide percentage. New domain transitions, error cases, protocol
normalizers, persistence migrations, and security policies require focused tests. Coverage reports
identify untested branches but do not replace behavior-based review. Changed-line coverage and
mutation results are diagnostic review signals, not incentives to add low-value assertions.

### 11.5 AI-authored change protocol

Because coding agents will author most changes, the repository makes confidence requirements
explicit:

1. Before editing, identify the observable outcome, failure modes, and single primary test owner.
2. For a defect, reproduce it with a failing regression test before changing production behavior.
3. Run the smallest relevant static and test checks during iteration, then the complete affected
   project before handoff. CI remains responsible for the full matrix.
4. Review tests and implementation as separate logical changes. A test must express the contract,
   not restate the implementation that the same agent just wrote.
5. Any deleted or weakened test, assertion, fixture, lint rule, type boundary, or mutation threshold
   is called out explicitly with the product-contract reason.
6. New test infrastructure requires a demonstrated behavior that the existing harness cannot express;
   agents may not add competing render helpers, fake servers, assertion libraries, or test runners.

CI records duration by project and reports the slowest tests. Budgets are set from the Milestone 1
baseline and ratcheted deliberately; parallelism, sharding, or retries must never mask shared state
or nondeterminism.

## 12. Security and privacy

- Bind locally by default.
- Require pairing and authenticated sessions before accepting non-loopback clients.
- Store secrets using OS-backed secure storage from Electron when available; persist only references
  or encrypted values in application storage.
- Redact credentials, prompt attachments, environment variables, and absolute user paths from logs.
- Validate every path at the server boundary and constrain operations to registered project roots.
- Treat ACP agents as trusted coding agents with powerful local access, while still enforcing the
  selected permission mode and surfacing requested approvals.
- Never execute commands received directly from an untrusted browser without a typed authorized
  server operation.
- No telemetry leaves the machine in the MVP.
- Keep renderer sandboxing, context isolation, CSP, IPC sender validation, navigation allowlists, and
  Electron fuse hardening as release-blocking requirements rather than optional hardening.

## 13. Observability

- Structured logs with environment, adapter, project, thread, turn, and event correlation IDs.
- Bounded diagnostic retention with user-controlled export.
- Effect tracing around ACP request latency, queue lag, database transactions, Git operations, and
  WebSocket subscriptions.
- Local-only diagnostics screen for process health, capabilities, schema version, and recent errors.
- Never expose chain-of-thought; display only provider-supplied user-visible summaries.
- Raw ACP/native diagnostics are opt-in, redacted before write, and rotated by total size and age.

## 14. Delivery milestones

### Milestone 0: Foundation

- pnpm workspace and package boundaries.
- web, Nitro server, and Electron applications all build.
- architecture spike proving the Electron → Nitro child-process lifecycle, authenticated loopback
  origin, Effect lifetime, native SQLite packaging, readiness, crash policy, and shutdown.
- toolchain spike choosing one owner for Vite+/format/lint/test configuration while retaining explicit
  Vue SFC typechecking.
- Effect composition root and SQLite migrations.
- the named Vitest projects, shared contracts, deterministic fake ACP executable, MSW harness, and CI
  quality gates.
- an initial targeted Stryker configuration that can establish a baseline once critical domain
  modules exist.
- design tokens and accessible application shell.

### Milestone 1: Deterministic vertical slice

- project creation.
- fake ACP adapter connection and capability negotiation.
- thread creation, prompt streaming, tool activity, permission response, and persistence.
- browser and Electron critical-path tests.

### Milestone 2: Real Codex and Claude

- pinned adapters, authentication surfaces, capability-aware settings.
- session resume/load reconciliation, cancellation completion, stale interactions, diagnostics, and
  provider fixture suites.
- provider-specific metadata normalized without leaking into UI models.

### Milestone 3: Git review and recovery

- pre/post-turn checkpoints, changed files, diff review, destructive preview, undo checkpoint, and
  confirmed file restoration without claiming provider conversation rewind.
- restart/replay tests and failure recovery.

### Milestone 4: Agent map

- graph projection, Codex and Claude hierarchy support, Vue Flow surface, filters, minimap, and
  transcript navigation.
- deterministic graph and browser integration tests.

### Milestone 5: MVP hardening

- pairing and trusted-network web access.
- performance profiling and buffer limits.
- packaging smoke tests and private release artifacts.
- reviewed mutation baseline, repeated flake-detection job, and no expired quarantines.
- documentation for installation, provider setup, backup, and recovery.

## 15. MVP acceptance criteria

The MVP is complete when:

1. The same repository can be opened in web and packaged Electron surfaces.
2. A locally authenticated Codex or Claude ACP adapter can create and continue a session.
3. Messages, plans, tools, permissions, terminal activity, and final state render accurately.
4. A restart restores durable projects, completed transcripts, checkpoints, and graph state. Active
   turns become interrupted or recovery-required, live interactions become stale, and provider
   continuation follows explicit resume/load capability semantics.
5. Native subagents appear in the map when adapter metadata supports them; lack of metadata degrades
   honestly to a single-node session.
6. Changed files can be reviewed and a confirmed checkpoint restoration works in integration tests.
7. Remote browser access cannot reach environment data without pairing and authorization.
8. Web, server, and desktop builds pass format, lint, compiler typecheck, applicable unit/property,
   contract, backend integration, browser feature integration, and critical E2E checks.
9. No test depends on the user's real provider state, application database, or arbitrary sleeps.
10. Provider internals, ACP framing, SQLite transaction order, and Git plumbing remain hidden behind
    narrow domain interfaces.
11. Retried mutations do not duplicate accepted commands, and uncertain provider or destructive
    effects are never replayed blindly.
12. A slow or reconnecting client resynchronizes from a sequence-bound snapshot without gaps or
    duplicate visible state.
13. The authoritative PR run has zero retries, no unexplained skipped tests or known quarantined
    flakes, and no test depends on implementation-only Vue APIs or selectors.
14. Mutation testing has a reviewed baseline for the critical domain modules named in Section 10.8;
    surviving mutants are triaged rather than hidden by broad exclusions.
15. Add project opens the native desktop picker directly; successful selection continues to a focused
    local draft without an intermediate confirmation form or durable empty thread.
16. First-send rejection preserves the complete local draft and creates no thread, while failure after
    acceptance is represented as a durable failed or recovery-required turn.

## 16. Definition of done for every feature

A feature is done only when:

- External and public-package behavior and failure modes are represented in typed contracts.
- External input is decoded at its boundary.
- Every meaningful behavior has one primary owner in the testing matrix; it is not duplicated across
  layers merely to increase test count.
- Pure domain behavior has focused tests when it contains meaningful decisions or invariants.
- Applicable backend boundary behavior has an integration or contract test.
- User-visible Vue behavior has a feature-level browser test; reusable primitives receive isolated
  browser tests only when their interaction complexity warrants it.
- The critical journey has E2E coverage only when lower layers cannot provide equivalent confidence.
- A bug fix includes a regression test that demonstrably fails before the implementation change.
- Tests exercise observable behavior without internal module mocks, component internals, brittle
  selectors, arbitrary sleeps, or retry-to-green behavior.
- Assertions, fixtures, quality rules, and mutation thresholds were not weakened without an explicit
  reviewed reason.
- Web and desktop applicability has been considered explicitly.
- Codex, Claude, and unsupported-capability behavior have been considered explicitly.
- Entry and reverse actions exist where applicable.
- Accessibility, keyboard use, performance, privacy, and recovery have been reviewed.
- Relevant documentation and migrations are included.
- Targeted local checks and all required CI gates pass.

## 17. References

- [T3 Code](https://github.com/pingdotgg/t3code) — product and architecture reference.
- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) — stable provider boundary.
- [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk).
- [Codex ACP adapter](https://github.com/agentclientprotocol/codex-acp).
- [Claude Agent ACP adapter](https://github.com/agentclientprotocol/claude-agent-acp).
- [Vue Flow](https://vueflow.dev/) — agent map implementation.
- [Nitro](https://nitro.build/) — server runtime.
- [Effect](https://effect.website/) — typed effects, streams, supervision, and SQL integration.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) — desktop threat
  model and renderer hardening.
- [pnpm supply-chain security](https://pnpm.io/supply-chain-security) — dependency-install defaults.
- [WAI-ARIA tree view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) — accessible agent
  hierarchy alternative.
- [The Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) —
  confidence-weighted test ownership.
- [Vitest test projects](https://vitest.dev/guide/projects) and
  [Browser Mode](https://vitest.dev/guide/browser/) — Node/browser project topology.
- [Vitest request mocking](https://vitest.dev/guide/mocking/requests) and
  [MSW](https://mswjs.io/) — HTTP and WebSocket boundary fakes.
- [Playwright best practices](https://playwright.dev/docs/best-practices) — user-facing locators and
  web-first assertions.
- [fast-check with Vitest](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest/)
  — reproducible property and state-model testing.
- [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/) — targeted mutation
  testing and its Browser Mode limitation.
- John Ousterhout's deep-module principle as summarized in “Modules Should Be Deep,” from
  *Software Engineering: A Modern Approach*.

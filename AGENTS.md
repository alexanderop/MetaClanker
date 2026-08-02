# MetaClanker agent guide

## Purpose

MetaClanker is a private, local-first control surface for Codex and Claude coding agents. It ships the same conversation-first workspace through a Vue web app and a packaged Electron app. The Nitro server owns authentication, ACP subprocesses, durable SQLite state, Git checkpoints, recovery, and event delivery.

Read the relevant part of [docs/architecture.md](docs/architecture.md) before changing product behavior or architecture. Read [docs/testing.md](docs/testing.md) before changing tests, test infrastructure, asynchronous orchestration, or CI behavior. Read [docs/ui-components.md](docs/ui-components.md) before adding a UI component, changing `apps/web/src/ui`, or editing `apps/web/src/shared/styles.css`. Read [docs/vue-components.md](docs/vue-components.md) before writing or reorganizing a `<script setup>` block in `apps/web`. Use [README.md](README.md) for current setup, provider, privacy, backup, and operational details. Do not silently resolve a conflict between a specification and the implementation: preserve the stated contract or call out the discrepancy. `docs/architecture.md` is authoritative when specifications conflict.

`docs/` holds only durable contracts—material that stays true across initiatives and orients a new contributor. A specification written for one in-flight initiative belongs in `.spec/`, which is gitignored and periodically deleted; see `.spec/README.md`. Never cite a `.spec/` path from a committed file, and promote a rule into `docs/` before the initiative that produced it is pruned.

## Repository map

- `apps/web`: Vue 3 presentation, routing, features, shared client state, and API client.
- `apps/web/src/ui`: owned presentational primitives; reka-ui behavior, `cva` variants, token-only styling.
- `apps/server`: Nitro routes, authentication, orchestration, subscriptions, and the composition root.
- `apps/desktop`: Electron lifecycle and the narrow sandboxed preload bridge.
- `packages/contracts`: branded IDs and public Effect Schema wire contracts only.
- `packages/application`: commands and narrow ports; no concrete infrastructure.
- `packages/domain`: pure events, policies, state transitions, and graph layout.
- `packages/acp-client`: ACP framing, provider metadata normalization, process supervision, and session runtime.
- `packages/persistence`: SQLite migrations, events, projections, receipts, recovery, and backups.
- `packages/git`: scoped checkpoint, diff, preview, and restore operations.
- `packages/testing`: deterministic ACP fake, fixtures, builders, and test support.
- `tests/e2e`: production Vue/Nitro/fake-ACP journeys. `tests/package-smoke.mjs` owns packaged desktop topology.
- `docs`: committed durable contracts—architecture, testing, UI components, Vue authoring.
- `.spec`: gitignored working specifications for in-flight initiatives; disposable, never referenced from committed files.

Work in source directories. Never edit generated `dist`, `.output`, `.nitro`, `.packaging`, `artifacts`, reports, or test-result files.

## Architectural invariants

- Dependency direction is `web -> contracts`, transport routes `-> application/domain`, and the server composition root `-> persistence/git/ACP implementations`.
- Provider-specific JSON-RPC, metadata, capabilities, and subprocess details stay inside `packages/acp-client`. Everywhere else consumes normalized events and provider-neutral interfaces.
- Decode external input at its boundary with Effect Schema. Keep public wire schemas separate from internal persisted-event schemas.
- Backend resources and failure-producing workflows use Effect scopes, layers, streams/queues, interruption, and typed errors. Vue components do not execute Effect programs.
- In `apps/web`, views compose features; features do not import other features; shared code imports neither features nor views; `ui` imports none of them. Components render state and emit intent; domain decisions remain in pure modules.
- Each Vue application and browser-test mount owns one explicit Effect Atom registry and fresh runtime memo map. SFCs consume only project-owned `use*Model` facades; they never import Atom, Effect runtime modules, raw Causes, or the implicit default registry. Pinia remains authoritative only for slices not yet migrated, and a slice never mirrors writable authority between Pinia and atoms.
- A `<script setup>` block groups related state, effects, and handlers into named `use*()` inline composables so its opening lines name the component's responsibilities. Extract a composable to its own file only once a second component needs it. See [docs/vue-components.md](docs/vue-components.md).
- UI primitives own appearance only. Focus, portal, dismissal, and roving-tabindex behavior is delegated to reka-ui. Every primitive last-merges a `class` prop; `data-slot` is a styling hook and never a test selector.
- Every mutation carries a stable `commandId`. Accepted/rejected receipts, durable events, and projections remain transactionally consistent. Never blindly retry an uncertain prompt dispatch or destructive filesystem action.
- Crash recovery is explicit: interrupted active threads become recovery-required, live interactions become stale, and provider continuation follows advertised resume/load capabilities.
- Git and filesystem operations are constrained to registered project roots. Destructive restore requires preview, confirmation, an idle root session, and an undo checkpoint.
- Preserve local-first privacy: local bind by default, pairing for non-loopback access, no credential-file reads, no telemetry, and no prompt, attachment, environment, credential, raw provider envelope, or absolute-path leakage in logs/errors.
- Preserve Electron isolation, sender validation, navigation/permission allowlists, fuse hardening, server readiness checks, restart limits, and verified child-process cleanup.

## Change protocol

1. Inspect `git status`, the relevant specification section, and neighboring implementation/tests before editing. Preserve unrelated user changes.
2. State the observable outcome and failure modes. For a defect, add a regression test that fails for the original behavior before changing production code.
3. Put each behavior in its lowest useful test lane. Do not duplicate it across layers merely to increase coverage.
4. Use the existing helpers, fake ACP process, and test topology. Do not add a competing runner, render helper, fake server, assertion library, retry, arbitrary sleep, broad snapshot, internal Vue mock, or implementation-only selector.
5. Never weaken or delete a test, assertion, type boundary, lint rule, fixture, security control, or mutation threshold without explaining the product-contract reason.
6. Update documentation and migrations with the behavior they describe. Consider web and desktop, Codex and Claude, unsupported capabilities, accessibility, keyboard use, privacy, performance, and recovery.

## Testing strategy

MetaClanker follows a Testing Trophy: static analysis is the base, most behavioral confidence comes from integration tests, focused units protect pure decisions, browser tests own visible behavior, and only a few E2E journeys prove the production topology. Test for confidence per maintenance cost, not test count or a repository-wide coverage percentage.

Every meaningful behavior has one primary owner at the cheapest layer that exercises its real contract:

1. **Static and type contracts**: syntax, types, architecture boundaries, branded IDs, exhaustive public unions, and preload/API shapes. Use `*.test-d.ts` only for intentional compile-time contracts.
2. **Node unit/property**: pure reducers, policies, normalization, state machines, layout, recovery decisions, path containment, and deterministic migrations. Use `*.unit.test.ts`; use `@fast-check/vitest` when generated sequences or inputs materially improve confidence.
3. **Wire and ACP contract**: Effect Schema boundaries, HTTP/WebSocket payload compatibility, ACP framing, capabilities, ordering, cancellation, malformed input, process failure, and provider normalization. Use `*.contract.test.ts` and the real production ACP supervisor against the deterministic fake over stdio.
4. **Backend integration**: collaboration between application commands and real temporary SQLite, Git, filesystem, ACP stdio, Nitro, recovery, and event delivery. Use `*.integration.test.ts`. Fake only external or nondeterministic boundaries such as provider processes, network, time, randomness, OS dialogs, and secure storage.
5. **Browser feature integration**: user-visible Vue behavior in real Chromium. Use `*.browser.test.ts` with real parent/child components, the slice's real app-scoped client model, router, i18n, and browser APIs; MSW replaces only HTTP/WebSocket transport. Query by role and accessible name and assert visible outcomes.
6. **Production web E2E**: only critical journeys requiring built Vue, Nitro, WebSocket, SQLite, Git, filesystem, and fake ACP together. Keep edge cases in lower lanes.
7. **Packaged Electron smoke**: artifact startup, preload isolation, native ABI, server readiness, renderer loading, restart bounds, and child-process cleanup.

When behavior crosses layers, select one primary owner and add only the supporting proof required at another boundary. Do not repeat the same edge cases across unit, browser, and E2E tests.

Backend asynchronous tests wait on typed runtime milestones, stream events/cursors, captured process exits, or drainable workers. Browser and E2E tests wait on role-visible state. Arbitrary sleeps, `waitForTimeout`, `networkidle`, poll-until-timeout loops, test retries, and retry-to-green workflows are prohibited. A timeout may only guard a hung test and produce diagnostics; elapsed time is never the success condition.

Tests and workers own unique temporary data directories, databases, repositories, ports, and subprocesses. Never point a test at the user's real MetaClanker, Codex, Claude, credential, or Git state. Cleanup must close scopes and assert that no process, socket, listener, database handle, MSW override, or browser state leaked.

For every defect, first add a regression test that fails for the original behavior at the lowest realistic lane. For new backend mutations, cover accepted, rejected, duplicate/retried, interrupted, and recovery behavior where applicable. Review tests as product contracts: assert visible or durable outcomes instead of private calls, object internals, or implementation branches.

## Commands and verification

Use Node 24+, Corepack, and the pinned pnpm version. Keep exact dependency versions and the committed lockfile. ACP adapter upgrades are explicit compatibility changes; do not float or casually update the pinned tuple.

- `pnpm check`: canonical local gate—format, lint, strict TS/`vue-tsc`, unit, contract, integration, browser UI, and production builds.
- `pnpm test:types`: compiler and Vue template contracts.
- `pnpm test:unit`: pure Node unit and property tests.
- `pnpm test:contract`: wire-schema and ACP protocol contracts.
- `pnpm test:integration`: Effect-backed backend integration with isolated real infrastructure.
- `pnpm test:browser`: real-Chromium Vue feature integration.
- `pnpm test:e2e:web`: two production Nitro/Vue journeys using real SQLite, Git, filesystem, event transport, and fake ACP stdio.
- `pnpm knip`: package, file, export, and dependency graph audit.
- `pnpm test:mutation`: targeted graph/thread mutation baseline; run when critical domain behavior or its tests change.
- `pnpm package:desktop && pnpm test:smoke:package`: required for Electron lifecycle, preload, native dependency, packaging, server-startup, or shutdown changes.

During iteration, run the narrowest relevant command. Before handoff, run `pnpm check` for code changes plus every affected boundary command above. Tests run with zero retries; fix flakes and leaked processes rather than masking them. Report what changed, exact verification performed, and any remaining risk or unverified platform/provider behavior.

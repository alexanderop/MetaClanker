# MetaClanker agent guide

## Purpose

MetaClanker is a private, local-first control surface for Codex and Claude coding agents. It ships the same conversation-first workspace through a Vue web app and a packaged Electron app. The Nitro server owns authentication, ACP subprocesses, durable SQLite state, Git checkpoints, recovery, and event delivery.

Read the relevant part of [SPEC.md](SPEC.md) before changing product behavior or architecture. Use [README.md](README.md) for current setup, provider, privacy, backup, and operational details. Do not silently resolve a conflict between the specification and implementation: preserve the stated contract or call out the discrepancy.

## Repository map

- `apps/web`: Vue 3 presentation, routing, features, shared client state, and API client.
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

Work in source directories. Never edit generated `dist`, `.output`, `.nitro`, `.packaging`, `artifacts`, reports, or test-result files.

## Architectural invariants

- Dependency direction is `web -> contracts`, transport routes `-> application/domain`, and the server composition root `-> persistence/git/ACP implementations`.
- Provider-specific JSON-RPC, metadata, capabilities, and subprocess details stay inside `packages/acp-client`. Everywhere else consumes normalized events and provider-neutral interfaces.
- Decode external input at its boundary with Effect Schema. Keep public wire schemas separate from internal persisted-event schemas.
- Backend resources and failure-producing workflows use Effect scopes, layers, streams/queues, interruption, and typed errors. Vue components do not execute Effect programs.
- In `apps/web`, views compose features; features do not import other features; shared code imports neither features nor views. Components render state and emit intent; domain decisions remain in pure modules.
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

## Commands and verification

Use Node 24+, Corepack, and the pinned pnpm version. Keep exact dependency versions and the committed lockfile. ACP adapter upgrades are explicit compatibility changes; do not float or casually update the pinned tuple.

- `pnpm check`: canonical local gate—format, lint, strict TS/`vue-tsc`, unit, contract, integration, browser UI, and production builds.
- `pnpm test:e2e:web`: two production Nitro/Vue journeys using real SQLite, Git, filesystem, event transport, and fake ACP stdio.
- `pnpm knip`: package, file, export, and dependency graph audit.
- `pnpm test:mutation`: targeted graph/thread mutation baseline; run when critical domain behavior or its tests change.
- `pnpm package:desktop && pnpm test:smoke:package`: required for Electron lifecycle, preload, native dependency, packaging, server-startup, or shutdown changes.

During iteration, run the narrowest relevant command. Before handoff, run `pnpm check` for code changes plus every affected boundary command above. Tests run with zero retries; fix flakes and leaked processes rather than masking them. Report what changed, exact verification performed, and any remaining risk or unverified platform/provider behavior.

# MetaClanker desktop validation progress

## 2026-08-01 — baseline

- Packaged the current Electron artifact successfully with `pnpm package:desktop`.
- Opened the packaged app through Computer Use. Initial onboarding rendered correctly: sidebar, Add project action, settings action, and empty-state content were all visible.
- Validation projects are isolated temporary directories: one Git repository and one non-Git directory. They will be used only to exercise the desktop app and Codex provider; no user repository state is involved.

## Findings

- Fixed: a live `thread-status` event updated the selected thread header but left the corresponding sidebar conversation row stale. Reproduction in the packaged app: complete a Codex turn, then observe **Completed** in the header while the sidebar still announces **running**; a reload corrected the sidebar.
  - Root cause: `workspaceStore.applyEvent` updated only `detail.thread.status`, not `shell.threads`.
  - Regression coverage: `a completed live turn updates its sidebar status without a reload` in `apps/web/src/features/projects/project-navigation.browser.test.ts`. It failed before the fix and passes after it.
  - Fix: update the matching shell thread whenever a `thread-status` live event arrives.
- Investigated and ruled out: the first Codex turn initially looked stale in the transcript, but a second timed observation showed the real event stream correctly updates the active thread and transcript. The earlier observation was made before the provider turn had finished.

## Real packaged-app coverage

- Native folder picker registered both an isolated Git project and an isolated non-Git project.
- Codex completed two prompts in the Git project and one prompt in the non-Git project, with expected durable transcript output and completed status.
- Git project: agent map (spatial and accessible-tree modes) and clean review/checkpoint panel rendered correctly.
- Non-Git project: header explicitly reported `Git Unavailable` and disabled review with an explanatory accessible hint.

## Post-fix real-app verification

- Repackaged the Electron artifact and reopened it through Computer Use.
- Started a fresh Codex thread in the isolated Git project. After `METACLANKER_SIDEBAR_OK` completed, both the header and the newly created sidebar conversation entry reported `completed` without a reload.

## Automated verification

- `pnpm exec vitest run --project browser-ui apps/web/src/features/projects/project-navigation.browser.test.ts` — passed (4 tests); the new regression test was observed failing before the store change.
- `pnpm check` — passed: formatting, lint, styles, strict types, unit (21), contract (4), integration (13), browser UI (4), and production builds.
- `pnpm test:e2e:web` — passed: 2 production Nitro/Vue/fake-ACP journeys.
- `pnpm test:smoke:package` — passed: packaged Electron readiness, native picker-to-draft, SQLite, renderer load, and shutdown cleanup.

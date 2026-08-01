# MetaClanker

MetaClanker is a private, local-first control surface for Codex and Claude coding agents. It combines a conversation-first workspace, ACP subprocess supervision, durable transcripts, Git checkpoints and review, and an on-demand Vue Flow agent map in one shared web and Electron application.

The implementation follows [SPEC.md](SPEC.md). Provider-specific packages are confined to the ACP client package; Vue talks only to the authenticated Nitro contract.

## Requirements

- Node.js 24 or newer
- pnpm 11.18.0 through Corepack
- Git
- Chromium for browser tests (`pnpm exec playwright install chromium`)
- Existing local Codex and/or Claude authentication for real-provider sessions

MetaClanker never reads provider credential files. The pinned ACP adapters discover authentication through their own supported flows.

## Install and run

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:4318`. Vite serves the shared Vue application and proxies same-origin API and WebSocket traffic to Nitro on port 4317.

For a production web build:

```sh
pnpm build
HOST=127.0.0.1 PORT=4317 pnpm start
```

Then open `http://127.0.0.1:4317`. The Nitro artifact includes the Vue assets and SPA history fallback.

To build and run the private Electron artifact:

```sh
pnpm package:desktop
open artifacts/MetaClanker-darwin-arm64/MetaClanker.app
```

The artifact name follows the current operating system and CPU architecture. Electron owns one dynamic loopback server, validates readiness with a private token, uses an isolated/sandboxed renderer, and stops the child server on shutdown.

## Provider setup

The lockfile pins the ACP v1 compatibility tuple:

- `@agentclientprotocol/sdk` 1.3.0
- `@agentclientprotocol/codex-acp` 1.1.7
- `@agentclientprotocol/claude-agent-acp` 0.64.0

Authenticate with Codex or Claude before starting MetaClanker, using the provider's normal local tooling. Add a project, open or return to its local draft, choose the provider settings, and send the first prompt. The first send atomically creates the titled thread and initial turn before MetaClanker starts one supervised adapter process. A repeated accepted command returns the original thread and is never blindly dispatched again.

## Projects and new conversations

In the Electron app, **Add project** opens the operating system folder picker immediately. Choosing a valid folder registers it using the folder name and opens a focused local draft; the normal path has no second confirmation form. Git repositories enable checkpoints and review. Non-Git directories are supported, with Git-dependent actions visibly unavailable.

The browser surface cannot safely turn a client-machine folder handle into a server path. It therefore uses a constrained server-side directory browser. By default the browser is rooted at the server working directory. Set `METACLANKER_PROJECT_BROWSER_ROOTS` to a platform path-delimiter-separated list of allowed roots before starting Nitro to expose different server directories.

New chat opens or returns to one unsent draft per project. Prompt text, attachments, cursor position, provider, model, effort, and permission mode remain in browser-local storage until the first send is accepted. Opening, navigating away from, or discarding an empty draft creates no server thread or provider session.

For deterministic development without provider state, build the fake adapter and point Nitro at it:

```sh
pnpm --filter @metaclanker/testing build
METACLANKER_FAKE_ACP_ENTRY="$PWD/packages/testing/dist/acp/fake-agent.js" pnpm dev
```

## Data, pairing, and privacy

Desktop data lives in Electron's platform application-data directory. A manually started server defaults to `apps/server/.data`; set `METACLANKER_DATA_DIR` to an absolute directory to choose another location.

Loopback browsers authenticate automatically. For a browser on a trusted network, bind Nitro deliberately, use HTTPS at the network boundary, and configure a strong short-lived pairing secret:

```sh
HOST=0.0.0.0 PORT=4317 \
METACLANKER_PAIRING_CODE="$(openssl rand -base64 32)" \
METACLANKER_DATA_DIR=/absolute/private/metaclanker-data \
pnpm start
```

Submit that code to `POST /api/auth/pair` as `{ "code": "..." }`. The resulting session is HTTP-only and revocable with `POST /api/auth/logout`. A locally authenticated caller can read the current code from `GET /api/auth/pairing-code`; the route rejects non-loopback callers. Do not expose the server directly to the public internet.

If HTTPS terminates in a same-host reverse proxy, preserve the real client address in `X-Forwarded-For` and the public `Host` and `Origin` headers. Local bootstrap deliberately rejects forwarded non-loopback clients and non-loopback origins; remote clients must use pairing even though the proxy itself connects over loopback.

No telemetry leaves the machine. Server logs and public API errors avoid prompt attachments, credentials, environment variables, absolute project paths, and raw provider envelopes. Unsent conversation drafts are not transmitted to Nitro.

Optional local diagnostics are disabled by default. Set `METACLANKER_DIAGNOSTICS=1` to record structured operation timing and correlation IDs under `<data-directory>/diagnostics/`. The trace excludes prompts, attachments, environment values, raw provider envelopes, and project paths; it rotates at 1 MiB and expires after seven days.

## Backup and recovery

Create a transactionally consistent SQLite backup while MetaClanker is running:

```sh
cookie_jar=$(mktemp)
curl -sS -c "$cookie_jar" -X POST http://127.0.0.1:4317/api/auth/local
curl -sS -b "$cookie_jar" -X POST http://127.0.0.1:4317/api/maintenance/backup
```

The response names a file under `<data-directory>/backups/`. The SQLite backup contains projects, settings, durable events and projections, transcripts, interactions, graph state, command receipts, and checkpoint metadata. For a complete disaster-recovery copy, also preserve the immutable `<data-directory>/checkpoints/` directory.

To restore, quit every MetaClanker process, preserve the damaged data directory, replace `metaclanker.sqlite` with a selected backup, restore the matching `checkpoints/` directory, and restart. SQLite migrations run transactionally on startup. Threads that were active during a crash are never blindly resent; durable history remains readable and continuation follows the adapter's advertised resume/load capability.

File restoration inside a thread is separate from database recovery. The review panel shows a destructive preview, captures an undo checkpoint, and restores project files only while the root session is idle. It does not claim to rewind provider conversation state.

## Architecture

```text
apps/web       Vue 3, Pinia, Vue Router, Vue Flow, browser-only presentation
    │ HTTP + authenticated WebSocket (Effect Schema wire contracts)
apps/server    Nitro Node server, Effect composition root, auth and orchestration
    ├── packages/persistence  SQLite events, projections, migrations, receipts, backups
    ├── packages/git          scoped checkpoints, diff, preview, restore
    └── packages/acp-client   ACP v1 framing, normalization, supervised adapters
apps/desktop   Electron lifecycle, preload bridge, native packaging and fuse hardening
```

`packages/contracts` contains only branded identifiers and public wire schemas. `packages/application` defines commands and narrow ports. `packages/domain` owns pure transitions and graph layout. Provider internals, SQLite ordering, filesystem operations, and Git plumbing do not leak into Vue.

## Quality commands

```sh
pnpm check                 # format, lint, types, all Vitest lanes, browser UI, builds
pnpm test:e2e:web          # two production Nitro/Vue/fake-ACP journeys
pnpm package:desktop       # build the private packaged artifact
pnpm test:smoke:package    # launch, readiness, SQLite/native ABI, renderer, shutdown
pnpm knip                  # package/file/dependency graph audit
pnpm test:mutation         # targeted graph/thread mutation baseline
```

Vitest projects are named `node-unit`, `node-contract`, `node-integration`, and `browser-ui`. Playwright E2E and the packaged Electron smoke remain separate. The deterministic ACP fake uses real stdio framing; production E2E uses real Nitro, WebSocket, SQLite, Git, and filesystem boundaries without MSW or provider credentials.

Lefthook checks staged formatting and linting before commits and runs the confidence suite before pushes. GitHub Actions use frozen installs, full-SHA action pins, least-privilege permissions, zero test retries, production web journeys, a macOS package smoke, Gitleaks, and a scheduled mutation lane.

## Mutation baseline

The initial targeted baseline mutates only `packages/domain/src/graph.ts` and `packages/domain/src/thread.ts`. It scores 73.29%, with a 70% break threshold. Surviving mutations are concentrated in equivalent default-value changes, unexercised defensive branches, and multi-child layout arithmetic; they are visible in `reports/mutation/mutation.html` after a run and are not excluded from the target set.

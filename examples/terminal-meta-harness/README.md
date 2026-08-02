# Terminal meta-harness

This is the smallest useful version of MetaClanker: a TypeScript and React Ink terminal, one ACP
agent process, and one SQLite event log. It is intentionally a reference project for a blog post, not
a production coding tool.

## What is a meta-harness?

A coding agent decides how to solve a task. A **meta-harness** owns the environment around that agent:

1. It starts or connects to an agent.
2. It creates a session and sends user turns.
3. It turns protocol updates into a stable event vocabulary.
4. It asks the human for permissions.
5. It records what happened and cleans up the agent process.

ACP is the seam between the harness and the agent. The harness below does not know Codex or Claude's
private message format; both are launched behind the same ACP client contract.

```text
human -> React Ink -> TerminalHarness -> ACP over stdio -> provider adapter -> coding agent
                          |
                          +-> normalized events -> SQLite
```

The important idea is ownership. The agent owns reasoning and tool use. The meta-harness owns
sessions, policy, observation, durability, and lifecycle.

## Run it in one minute

From the MetaClanker repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @metaclanker/terminal-meta-harness demo
```

The demo uses a deterministic fake ACP agent, so it needs no credentials and makes no file changes.
Enter a prompt, choose permission option `1`, then enter `:quit`. The Ink transcript is rebuilt from
the same events stored in SQLite.

To use an authenticated local provider instead:

```sh
pnpm --filter @metaclanker/terminal-meta-harness start -- codex /absolute/project/path
pnpm --filter @metaclanker/terminal-meta-harness start -- claude /absolute/project/path
```

The default provider is `codex` and the default project is the current directory. History is stored
at `.meta-harness/history.sqlite`; override it with `META_HARNESS_DB=/absolute/path/history.sqlite`.

## Read the project in this order

1. [`src/App.tsx`](src/App.tsx) is the React Ink UI. It renders events and converts keystrokes into
   prompt or permission intent.
2. [`src/harness.ts`](src/harness.ts) is the core. It owns the child process, ACP initialization,
   session, turns, event normalization, and cleanup.
3. [`src/store.ts`](src/store.ts) is the durable boundary: two tables and an append-only event log.
4. [`src/cli.tsx`](src/cli.tsx) is the small composition root that connects Ink to the harness.
5. [`src/fake-agent.ts`](src/fake-agent.ts) is test support and an executable ACP example.

That is the entire foundation. The SDK handles newline-delimited JSON-RPC framing; the example stays
focused on the responsibilities that make it a harness.

## Follow one prompt

When the user submits text, `TerminalHarness` follows one explicit path:

```text
record user_message
        |
        v
send session/prompt
        |
        +-- session/update ----> normalize -> record -> render
        |
        +-- permission request -> ask user -> record response
        |
        v
record turn_finished
```

SQLite is useful here because rendering and history no longer depend on keeping the agent process
alive. It does **not** mean this proof of concept can safely resume an interrupted model turn. The
provider still owns model context, and production recovery must reconcile both sides.

## What was deliberately left out

This project has no web server, browser UI, authentication, Git checkpoints, filesystem/terminal ACP
capabilities, subagent graph, session resume, crash reconciliation, or command idempotency. Those are
product features and safety controls, not prerequisites for understanding the pattern.

The next production steps are architectural, not visual:

| Proof of concept             | Production meta-harness                             |
| ---------------------------- | --------------------------------------------------- |
| One child process            | Supervised, bounded process lifecycle               |
| One active session           | Durable session catalog and capability-aware resume |
| Append-only events           | Transactional events plus read projections          |
| Prompt dispatch              | Stable command IDs and uncertain-outcome handling   |
| Terminal permission question | Expiring, exactly-once interaction records          |
| Console errors               | Typed, redacted failures and diagnostics            |

## A compact blog-post spine

1. **The agent is not the app** — define the model/agent/harness layers.
2. **ACP gives us a replaceable boundary** — show the process and protocol diagram.
3. **React Ink renders state; it does not own the agent** — show `App.tsx` subscribing to events.
4. **A prompt is an orchestration flow** — walk through `#runTurn`.
5. **Events separate live output from durable truth** — introduce the SQLite journal.
6. **Permissions reveal who owns policy** — the harness asks; the agent cannot approve itself.
7. **Scale the foundations, not the interface** — map the proof of concept to production concerns.

Useful background: the [ACP overview](https://agentclientprotocol.com/protocol/overview) and the
[TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk).

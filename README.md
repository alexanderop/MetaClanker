# MetaClanker

MetaClanker is a private, local-first control surface for coding agents. It
provides one conversation-first interface for working with Codex and Claude
across local Git repositories, with an optional spatial map for navigating
agent and subagent activity.

## Vision

The normal experience is a focused chat workspace: create a thread, select an
agent provider, and follow streaming messages, tool activity, permissions,
terminal output, and file changes. When needed, the agent map provides a
high-level view of the active hierarchy without turning the application into a
workflow editor.

## Planned MVP

- Support Codex and Claude through the Agent Client Protocol (ACP).
- Share a Vue application between web and Electron desktop surfaces.
- Stream conversations, tool calls, terminal activity, plans, and permissions.
- Visualize native agent/subagent hierarchies with Vue Flow.
- Persist projects, threads, transcripts, graph state, and Git checkpoints
  locally.
- Review file changes and diffs, interrupt work, and restore checkpoints.

## Status

This repository currently contains the product and technical specification for
the MVP. See [SPEC.md](SPEC.md) for the full architecture, scope, and delivery
plan.

## Principles

- **Conversation first:** the map is an on-demand navigation surface.
- **Local first:** provider processes, repositories, terminals, and
  persistence remain under the user's control.
- **ACP at the boundary:** provider-specific integrations stay behind stable
  ACP adapters.
- **Quality as back pressure:** types, schemas, linting, tests, and builds are
  part of the product's development workflow.

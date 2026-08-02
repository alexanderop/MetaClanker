# MetaClanker

The agent guide for this repository lives in [AGENTS.md](AGENTS.md). Read it before making changes;
it is the authoritative entry point for purpose, repository layout, architectural invariants, the
change protocol, testing strategy, and verification commands.

## Where documentation lives

`docs/` is committed and holds only durable contracts—material that stays true across initiatives and
orients a new contributor. `.spec/` is gitignored, holds working specifications for in-flight
initiatives, and is pruned periodically; see [.spec/README.md](.spec/README.md).

Durable contracts, and when they apply:

- [docs/architecture.md](docs/architecture.md) — before changing product behavior or architecture.
  Authoritative when specifications conflict.
- [docs/testing.md](docs/testing.md) — before changing tests, test infrastructure, asynchronous
  orchestration, or CI behavior.
- [docs/ui-components.md](docs/ui-components.md) — before adding a UI component, changing
  `apps/web/src/ui`, or editing `apps/web/src/shared/styles.css`.
- [docs/vue-components.md](docs/vue-components.md) — before writing or reorganizing a
  `<script setup>` block in `apps/web`.

When a task needs a specification of its own, write it under `.spec/YYYY-MM-<slug>/`. Never cite a
`.spec/` path from a committed file: promote the rule into `docs/` first.

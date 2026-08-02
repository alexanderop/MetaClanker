# MetaClanker documentation

Durable contracts only. A document belongs here if it stays true after the change that produced it
ships, and if a contributor who joined today would be worse off without it. Specifications written
for one in-flight initiative live in `.spec/`, which is gitignored and pruned; see
[.spec/README.md](../.spec/README.md).

| Document                               | Read it before                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)     | Changing product behavior or architecture. Authoritative when documents conflict.               |
| [testing.md](testing.md)               | Changing tests, test infrastructure, asynchronous orchestration, or CI behavior.                |
| [ui-components.md](ui-components.md)   | Adding a UI component, changing `apps/web/src/ui`, or editing `apps/web/src/shared/styles.css`. |
| [vue-components.md](vue-components.md) | Writing or reorganizing a `<script setup>` block in `apps/web`.                                 |

## Onboarding order

Read [../README.md](../README.md) for setup and how to run the app, then
[../AGENTS.md](../AGENTS.md) for the repository map, architectural invariants, and verification
commands. `architecture.md` explains why the system is shaped the way it is; reach for the remaining
three when you touch the area they govern rather than reading them front to back.

## Adding a document

Prefer extending an existing document over adding a fifth. When a new one is genuinely warranted, add
it to the table above and to the corresponding list in [../AGENTS.md](../AGENTS.md) and
[../CLAUDE.md](../CLAUDE.md), so an agent reads it at the moment it becomes relevant.

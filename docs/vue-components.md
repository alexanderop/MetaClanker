# MetaClanker Vue component authoring

- Status: Implemented and enforced (2026-08-02)
- Owner: Frontend
- Audience: Frontend and test owners, and coding agents editing `apps/web`
- Related contract: [MetaClanker agent guide](../AGENTS.md)
- Related contract: [MetaClanker core UI component library](ui-components.md)
- Related contract: [MetaClanker testing strategy](testing.md)

## 1. Executive summary

`docs/ui-components.md` governs how a component _looks_. This specification governs how its
`<script setup>` block is _organised_.

A `<script setup>` block is a single flat scope. Nothing in the language stops a component from
accumulating twenty refs, six watchers and a dozen handlers in declaration order, and nothing marks
which of them belong together. Read top to bottom, such a component describes its mechanics but never
its responsibilities.

The rule here is the **inline composable**: related state, effects and handlers are grouped into a
named `use*()` function declared in the same `<script setup>` block. The top of the file becomes a
table of contents; the mechanics move below it. It is Martin Fowler's Extract Function applied to a
component, and it is deliberately cheaper than extracting to a file — no new module, no import, no
premature API.

`vue-cohesion/script-setup-cohesion` enforces a budget of ungrouped top-level units, and
`vue-cohesion/inline-composable-naming` enforces the naming.

## 2. The shape of a component

```vue
<script setup lang="ts">
// 1. imports
// 2. defineProps / defineEmits / defineModel
// 3. ambient handles: store, router, i18n
// 4. module constants: class strings, page sizes, lookup tables, pure helpers
// 5. the table of contents — one line per responsibility
// 6. the inline composables, in the order they were named above
</script>
```

Sections 1–4 are declarations. Section 5 is the part a reader should be able to skim and understand
what the component does. Section 6 is the part they only read when they need the detail.

`ProjectSidebar.vue` after this pattern:

```ts
const { visibleProjects, threadsForProject, projectName, contextualProjectId } =
  useSidebarProjects();
const { paletteOpen, closePalette } = useCommandPalette();
const { projectOpen, path, saving, addError, openAddProject, addProject } = useAddProject();
const { settingsOpen, theme, graphDensity, openSettings, saveSettings } = useSettingsDialog();
useDeepLinkedDialogs({ openAddProject, openSettings });
```

Five lines name five responsibilities. The same file previously opened with fifteen `ref()` calls
whose only grouping was the order someone happened to add them.

## 3. When to use an inline composable

Group into a `use*()` function when **two or more** of the following move together:

- a piece of reactive state and the handlers that mutate it;
- a `watch`/`watchEffect`/lifecycle hook and the state it resets or derives;
- a template ref and the imperative DOM work that uses it;
- an async operation and its `busy` / `error` pair.

Do **not** group:

- a single `ref` with no logic attached — a lone `const mode = ref("canvas")` is already as clear as
  it will get, and wrapping it in `useMode()` adds a layer that explains nothing;
- unrelated things that merely happen to be adjacent — `useMisc()` and `useState()` are smells;
- pure helpers that touch no reactive state — those are module constants (section 4), and the lint
  rule already treats them as free.

A composable that returns one value and owns no effect is usually a `computed` wearing a costume.

## 4. When to extract to a file instead

Move an inline composable out of the SFC when **any** of these becomes true:

1. **A second component needs it.** This is the primary signal. Until then, a shared file is a
   guess about an API.
2. **It is pure and worth unit-testing directly.** Reactivity-free logic belongs in a plain module
   with a `*.unit.test.ts`, per the testing strategy — not in a composable at all.
3. **It exceeds roughly 60 lines.** At that size it has its own internal structure, and the host
   component is no longer the right place to read it.

Where it goes is fixed by the architecture invariants in `AGENTS.md`:

| Reused by                     | Location                                             |
| ----------------------------- | ---------------------------------------------------- |
| One feature's components      | alongside them in `apps/web/src/features/<feature>/` |
| More than one feature or view | `apps/web/src/shared/`                               |
| Nothing yet                   | leave it inline                                      |

`apps/web/src/ui` primitives may not import shared state at all, so a `ui` primitive never grows an
inline composable that reaches outside itself.

Extraction is a one-way door in practice — once a file exists, people import it. Prefer to stay
inline until the second consumer is real rather than anticipated.

## 5. Style rules

**Naming.** `use` + the noun the composable owns: `useAddProject`, `useStickyScroll`,
`usePagedTimeline`. Name the responsibility, not the mechanism — `useAgentFilters`, not
`useComputedFilteredNodes`.

**Return an object literal, not a tuple or a bare ref.** Destructuring at the call site is what makes
the table of contents readable, and it is what the naming rule detects.

**Declare composables as `function`, not `const`.** Function declarations hoist, so the table of
contents can sit above the definitions. A `const` composable forces the reader to scroll past every
implementation before reaching the summary.

**Order matters for `const` bindings.** A composable that reads another's return value must be called
after it. Keep call order matching read order.

**Pass dependencies explicitly when the seam is real.** `useFlowGraph(filteredNodes)` takes its input
as a parameter because the graph does not care where the nodes come from. Closing over an outer
binding is fine when the coupling is genuine and local — the point is readability, not purity.

**Let each composable own its own resets.** Prefer three small `watch(projectId, …)` calls living
beside the state they clear over one top-level watcher that reaches into three composables.

**Keep orchestration at the top level.** A function that several composables call back into —
`newChat` in `ProjectSidebar.vue` — stays a top-level `function` and is allowed to cost one unit.
Hiding a cycle inside a composable does not remove it.

**Templates are unchanged by this pattern.** Destructured refs stay reactive, so a refactor into
inline composables should not touch `<template>` and should not touch a single test.

## 6. Enforcement

`scripts/oxlint-vue-cohesion.mjs` is an oxlint JS plugin. It receives the `<script setup>` AST of
every `.vue` file and reports against a budget of _ungrouped top-level units_.

Costed as one unit each:

- **state** — `ref`/`shallowRef`/`computed`/`reactive`/`toRefs`/`storeToRefs`/`useTemplateRef`
  bindings, and any top-level `let` (mutable component state without the ceremony);
- **effect** — `watch`, `watchEffect`, a lifecycle hook, or a router/keyboard effect;
- **handler** — a top-level function that reaches component state, directly or through another
  handler. Reachability is resolved through oxlint's scope manager, so a parameter that shadows a
  ref does not count.

Free: imports, type declarations, compiler macros, plain constants, pure helpers, and anything named
`use*` — a `use*()` call or declaration is a named unit by construction.

Which call is a reactive one is decided by binding, not by spelling. `import { ref as state }` still
reads as `ref`, and a local `const computed = (v) => v * 2` does not read as one. A callee that
resolves to no binding is a global or an auto-import, so its written name is used; a member call
(`vue.ref()`) has no binding to resolve, so the property name is used.

Current budget is `max: 10`, set in `.oxlintrc.json`. The worst component in the repository sits at
8, so there is deliberate headroom; lower the budget when the tail catches up rather than raising it.

`vue-cohesion/inline-composable-naming` reports a top-level function that owns reactive state and
returns an object literal but is not named `use*`.

Known blind spots, covered by fixtures in `scripts/oxlint-vue-cohesion.test.mjs`:

- handlers hidden inside an object literal (`const handlers = { save: () => … }`) are not counted;
- the naming rule only recognises a literal `return { … }`, not `return result`.

### 6.1 Finding the `<script setup>` block

oxlint hands a JS plugin one `Program` per `<script>` block of an SFC and says nothing about which
block it came from — the `<script setup>` marker exists inside oxlint but is only wired to its
Rust rules. Both blocks are visited, so a plugin that ignores this reports module-scope `<script>`
code as if it were setup code, and reports twice on a two-block SFC.

The rules therefore read the SFC's own script tags and match the block by content. A plain
`<script>` block is out of scope for this pattern and is never counted, in either block order.

### 6.2 `no-shadow` is disabled for SFCs

`const { paletteOpen } = useCommandPalette()` necessarily reuses the name the composable declares
internally. That name agreement is the point of the pattern — it is what lets the call site read as a
summary — and `no-shadow` reads it as an accident. The rule is therefore off for
`apps/web/src/**/*.vue` only, via an override in `.oxlintrc.json`. It remains on everywhere else.

## 7. Testing

This pattern changes no public surface, so it is invisible to the test suite by design. Per the
testing strategy, browser tests own user-visible Vue behavior and query by role and accessible name;
a refactor into inline composables must leave them untouched and passing.

Do not test a composable by reaching into it. An inline composable has no export and no seam on
purpose — if it needs direct testing, that is signal it should be an extracted pure module per
section 4, tested as one.

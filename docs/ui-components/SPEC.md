# MetaClanker core UI component library

- Status: Foundation implemented and verified (2026-08-01); migration in progress
- Owner: Frontend
- Audience: Frontend, design, and test owners
- Related contract: [MetaClanker product and architecture specification](../../SPEC.md)
- Related contract: [MetaClanker testing strategy](../testing-strategy/SPEC.md)
- Related contract: [Conversation creation UX redesign](../ux-redesign/SPEC.md)

## 1. Executive summary

`apps/web` has no component library. Every visual decision lives in one 2,500-line global stylesheet
whose class names are bound to specific screens, and Vue components carry no styling responsibility at
all. The only reuse mechanism is remembering the correct global class name, so each new surface either
borrows a class that was not designed for it or appends new rules to the end of the file.

This specification adopts the authoring patterns proven by shadcn-vue — owned source, tokens in CSS,
variants as data, unconditional `class` passthrough, and compound components — without depending on
shadcn-vue itself. Behavior for interactive primitives is delegated to reka-ui rather than hand-rolled.

The result is a `apps/web/src/ui` layer of small, owned, individually reviewable primitives, and a
strangler migration that deletes the stylesheet rule in the same commit that removes its last consumer.

## 2. Problem statement

### 2.1 Measured starting condition

- `apps/web/src/shared/styles.css` was 2,516 lines with roughly 200 hand-written class names.
- Class names are screen-bound: `.project-heading`, `.draft-composer`, `.command-palette`.
- Rules are re-declared rather than revised. A `/* Conversation-first workspace */` block appended at
  the end of the file redefines `.sidebar`, `.brand`, and `.welcome-view` on top of earlier rules.
- Duplication was already load-bearing: 28 uses of `.button`, 11 of `.modal`, 4 hand-rolled native
  `<dialog>` elements, and 16 form controls across 5 files each carrying per-file styling rules.
- Tailwind v4 was installed but unused. `knip.json` listed `tailwindcss` under `ignoreDependencies` to
  suppress the resulting audit failure.

### 2.2 Product consequences

- A new surface cannot be built from existing parts, only from existing class names.
- Styling drift is invisible. `DraftView.vue` shipped `class="button quiet"` where `.quiet` had never
  been defined in the stylesheet, so that control rendered unstyled without any signal.
- Accessibility behavior is re-implemented per surface instead of being owned once.
- The stylesheet only grows, because deleting a rule requires proving no screen still depends on it.

## 3. Principles

### 3.1 Own the source

Components live in this repository and are edited directly. No component library is taken as a runtime
dependency. Upstream is a reference, not an upgrade path.

### 3.2 Tokens in CSS, variants in TypeScript

Theme values are CSS custom properties. Which token a component uses in a given state is a typed variant
table. No component references a raw colour, radius, or shadow value.

### 3.3 The caller always wins

Every primitive accepts a `class` prop that is merged last. This is the escape hatch that keeps a
component reusable instead of forked the first time it does not quite fit.

### 3.4 Behavior is delegated, appearance is owned

Focus management, portalling, roving tabindex, and dismissal semantics come from reka-ui. Layout,
colour, spacing, and typography are ours.

### 3.5 Composition over configuration

A surface is assembled from small parts with their own names, not from one component with many props.

### 3.6 The stylesheet only shrinks

A migration commit removes the stylesheet rules whose last consumer it removed. Partial migration that
leaves both systems live for the same rule is not complete work.

## 4. Placement and layering

The library lives at `apps/web/src/ui`. It is not a workspace package: only `apps/web` consumes it, and
`apps/desktop` loads the built web application rather than importing components.

The existing `apps/web` layering invariant is extended with one rule:

> `ui` imports nothing from `shared`, `features`, or `views`.

`ui` therefore sits below `shared` in the dependency direction. A component that needs workspace state,
routing, or the API client is a feature, not a primitive.

Directory shape follows one directory per component, with a barrel:

```
src/ui/utils.ts                 cn()
src/ui/button/index.ts          buttonVariants (cva) + re-export
src/ui/button/Button.vue
src/ui/dialog/index.ts          barrel
src/ui/dialog/DialogContent.vue
```

## 5. Token model

Tokens are declared in `apps/web/src/shared/styles.css` in two tiers.

### 5.1 Base tier

The base palette, radii, and shadows are declared in a `@theme` block. This is deliberately not
`@theme inline`. Non-inline `@theme` does two things at once:

1. Generates Tailwind utilities (`bg-surface`, `rounded-md`, `shadow-soft`).
2. Re-emits every token as a custom property on `:root`.

Consequence (2) is what makes the migration incremental: all remaining hand-written CSS continues to
resolve `var(--color-surface)` unchanged. Consequence (1) combined with non-inline resolution means
utilities reference the variable rather than its value, so the existing `prefers-color-scheme` and
`[data-theme]` override blocks flip every utility without a `dark:` variant.

### 5.2 Semantic tier

A second `@theme inline` block maps the shadcn token contract onto the base tier:
`--color-background`, `--color-foreground`, `--color-muted-foreground`, `--color-card`,
`--color-primary`, `--color-primary-foreground`, `--color-destructive`, `--color-ring`.

`inline` is correct here: the alias resolves to `var(--color-*)` at build time and still flips at
runtime. This tier exists so upstream patterns and examples drop in without translation.

### 5.3 Domain tokens

Provider and status colours (`--color-codex`, `--color-claude`, `--color-warning`, `--color-danger`)
stay in the base tier and are consumed through `data-*` attribute variants. A provider identity is not
a semantic role and must not be aliased into the semantic tier.

## 6. Component authoring rules

1. Variants are a `cva` table exported from the component's `index.ts`, separately from the component,
   so a non-component consumer can request the same classes.
2. `defaultVariants` in the `cva` table is the single source of truth for fallback appearance. Vue prop
   defaults for `variant` and `size` are explicitly `undefined`.
3. Every component accepts `class?: HTMLAttributes["class"]` and merges it last through `cn`.
4. Every rendered root element carries a `data-slot` attribute naming its role.
5. Polymorphic components render through reka's `Primitive` and support `as` and `as-child`.
6. Compound components export every part from one barrel and keep each part dumb.
7. Components hold no application state and emit no domain events.

### 6.1 data-slot is a styling hook, not a test selector

`data-slot` exists so a parent can style contextually without descendant selectors, for example
`has-data-[slot=dialog-close]:`. Tests continue to query by role and accessible name. A test that
selects on `data-slot` is an implementation-only selector and is prohibited by the testing strategy.

## 7. reka-ui boundary

reka-ui is a pinned exact dependency of `apps/web`. It owns behavior, not appearance.

### 7.1 reka owns

Dialog, Select, Collapsible, Popover, DropdownMenu, Tooltip, ToggleGroup, ScrollArea, Separator, Label,
and any future primitive requiring focus trapping, portalling, roving tabindex, or dismissal semantics.

### 7.2 We own

Button, Badge, Card, Field, and other presentational shells. These use reka only for `Primitive`, to
obtain `as` and `as-child` polymorphism.

### 7.3 Forwarding pattern

Wrappers around a reka primitive forward its props and emits as typed contracts using `reactiveOmit`
from `@vueuse/core` together with `useForwardPropsEmits` from reka-ui, withholding only `class`.
Forwarding through `$attrs` is not acceptable for these wrappers: it silently accepts a misspelled
handler that `vue-tsc` would otherwise reject.

## 8. Known constraints

### 8.1 Native select must be preserved

`tests/e2e/workspace.spec.ts` uses Playwright `selectOption`, and
`apps/web/src/features/projects/project-navigation.browser.test.ts` uses `selectOptions`. Both drive a
real `<select>` element only. reka `Select` renders a custom listbox.

The Provider, Effort, Permissions, and project-scope controls must therefore be migrated to a
`NativeSelect` primitive that styles a real `<select>`. reka `Select` is reserved for pickers that
require custom option rendering, and adopting it for any existing control is a deliberate change that
must update the corresponding tests in the same commit.

### 8.2 Portalled content leaves the component subtree

reka renders overlays into `document.body`. Tests must query from the document or page root. Queries
scoped to a rendered container will not find dialog, popover, or dropdown content.

### 8.3 exactOptionalPropertyTypes rejects the upstream forwarding pattern

This repository enables `exactOptionalPropertyTypes`. `reactiveOmit` converts optional props into
required-but-possibly-undefined, which fails to satisfy a target whose property is optional and does not
admit `undefined`:

```
error TS2379: Types of property 'as' are incompatible.
  Type 'AsTag | Component | undefined' is not assignable to type 'AsTag | Component'.
```

The remedy is a concrete `withDefaults` value matching the reka primitive's own default, not a cast and
not relaxing the compiler flag. If this recurs beyond roughly four wrappers, replace it with one shared
`forwardProps` helper that drops undefined keys, and record that decision here.

### 8.4 Barrel exports must have consumers

`pnpm knip` reports an unused barrel export as dead code. Barrels list parts that are actually consumed;
a part is exported when its first consumer arrives. Adding `src/ui/**/index.ts` as a knip entry pattern
would permit a speculative public surface and is not adopted, because it would also hide genuinely dead
components. Revisit only if the per-component cost becomes material.

## 9. Testing rules

The testing strategy is unchanged. This library adds three constraints:

1. Primitives get no dedicated test lane. They are proven through the browser feature tests of the
   surfaces that consume them. A primitive with no consumer is not shipped.
2. A migration commit must not modify a test to accommodate a markup change. If a role, accessible name,
   or keyboard path changes, that is a product change requiring its own justification.
3. Accessible names are a contract. Replacing `aria-labelledby` with a reka `DialogTitle` is acceptable
   precisely because the resulting accessible name is identical; the existing assertion proves it.

## 10. Delivery status

### 10.1 Complete: foundation

Dependencies added to `apps/web` at exact pinned versions: `reka-ui` 2.10.1, `@vueuse/core` 14.4.0,
`class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0.

Delivered:

- `src/ui/utils.ts` — `cn`.
- `src/ui/button/` — `Button.vue`, `buttonVariants` with `primary`, `secondary`, `outline`, `ghost`,
  and `danger` variants and `default`, `sm`, `icon`, `icon-sm` sizes.
- `src/ui/dialog/` — `DialogContent`, `DialogOverlay`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, `DialogFooter`, `DialogEyebrow`, and the reka `DialogRoot` re-export.
- Two-tier token blocks in `shared/styles.css`.

Migrated: `features/conversation/Composer.vue`, `views/DraftView.vue` including its discard dialog.

Removed from `shared/styles.css`: `.composer-control`, `.composer-control:hover`, `.send-button`,
`.send-button.stop`, and both `.draft-controls .send-button` rules. The file moved from 2,516 to 2,493
lines with 29 lines added and 52 removed.

Verified with `pnpm check`, `pnpm knip`, and `pnpm test:e2e:web`, all passing with no test file changed.

Surfaces added after the foundation are authored on the library directly rather than migrated later:
they consume the primitives, style themselves with token-backed utilities, and add no rule to
`shared/styles.css`.

### 10.2 Slice 2: ProjectSidebar

The highest-value remaining migration. `features/projects/ProjectSidebar.vue` is 461 lines with roughly
40 legacy class uses, contains the last three native `<dialog>` elements, and is the sole remaining
consumer of `.modal`, `.modal-heading`, `.modal-actions`, and `.command-palette`.

- Convert the add-project, command palette, and settings dialogs from imperative `showModal()` and
  `close()` to reka `Dialog` with `v-model:open`.
- Add `DialogClose` and `DialogTrigger` to the dialog barrel as consumers appear.
- Introduce `NativeSelect` for the settings theme and density controls.
- Replace the manual `onMounted`/`onBeforeUnmount` `keydown` pair with `useEventListener`, and the
  hand-rolled `metaKey || ctrlKey` palette handling with `onKeyStroke`.
- Delete `.modal`, `.modal-heading`, `.modal-actions`, `.command-palette`, `.palette-actions`, and
  `.palette-projects`.

### 10.3 Slice 3: remaining button and control surfaces

Migrate the remaining `.button` and `.icon-button` consumers so both rules can be deleted:
`App.vue`, `features/conversation/ThreadHeader.vue`, `features/conversation/ReviewPanel.vue`,
`features/agent-map/AgentMap.vue`, and `views/WelcomeView.vue`.

Introduce `Field`, `Input`, `Textarea`, and `NativeSelect` and migrate the remaining form controls in
`DraftView.vue` and `ProjectSidebar.vue`.

### 10.4 Slice 4: display primitives

Introduce `Card`, `StatusBadge`, and `StatusDot` and migrate `PermissionCard.vue`, `Transcript.vue`,
`AgentTree.vue`, and the `.tool-card` and `.status-badge` rules.

Adopt reka `Collapsible` for sidebar project groups, whose `.project-chevron` currently renders a
non-functional affordance, and reka `ToggleGroup` for `.surface-switch` and `.view-toggle`, which today
are `aria-pressed` buttons without roving tabindex.

### 10.5 Slice 5: shell

`app-shell`, `sidebar`, and their collapsed and responsive variants migrate last. These are genuinely
application-specific and are the least valuable to abstract. They may remain hand-written CSS
indefinitely; that is an acceptable outcome, provided they consume tokens rather than raw values.

## 11. Ratchet

Status: specified, not yet implemented.

`apps/web/src/shared/styles.css` is to carry a line-count ceiling enforced in `pnpm check`. The ceiling
is lowered whenever a slice lands and is never raised. Without it, migration predictably stalls partway
and the repository carries two styling systems permanently.

The ceiling at the point this specification was written is 2,493 lines. It must be added before Slice 2
lands, so that the first large deletion is what sets the ratchet rather than the last.

## 12. Acceptance criteria

The library is established when:

1. No component in `apps/web` declares a colour, radius, or shadow value outside the token blocks.
2. Every primitive accepts and last-merges a `class` prop.
3. Every interactive primitive requiring focus, portal, or roving-tabindex behavior delegates it to
   reka-ui rather than implementing it.
4. `ui` imports nothing from `shared`, `features`, or `views`.
5. No native `<dialog>` remains in `apps/web`.
6. `.button`, `.icon-button`, `.modal`, `.send-button`, and `.composer-control` are absent from
   `shared/styles.css`.
7. `shared/styles.css` contains only tokens, resets, shell layout, and third-party overrides.
8. Every migration slice landed without modifying a test to accommodate markup.
9. `pnpm check`, `pnpm knip`, and `pnpm test:e2e:web` pass at every slice boundary.

## 13. Definition of done per slice

- The stylesheet rules whose last consumer the slice removed are deleted in the same commit.
- The ratchet ceiling is lowered to the new line count.
- No test file is modified, or the product reason for each modification is stated.
- Light and dark themes, keyboard traversal, focus visibility, narrow viewport, and reduced motion are
  verified for every migrated surface.
- New user-visible copy is in the message catalog.
- `pnpm check` passes, plus `pnpm test:e2e:web` when a migrated surface is on an end-to-end journey.

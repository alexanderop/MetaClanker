# MetaClanker core UI component library

- Status: Implemented and verified (2026-08-01); all five slices landed
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
src/ui/control-variants.ts      the box shared by Input and NativeSelect
src/ui/button/index.ts          buttonVariants (cva) + re-export
src/ui/button/Button.vue
src/ui/dialog/index.ts          barrel
src/ui/dialog/DialogContent.vue
```

The shipped set is `button`, `card`, `collapsible`, `dialog`, `empty-state`, `eyebrow`, `field`,
`input`, `native-select`, `provider-mark`, `status-badge`, `textarea`, and `toggle-group`.

## 5. Token model

Tokens are declared in `apps/web/src/shared/styles.css` in three tiers. The governing rule is that
**every value a designer would want to change lives in exactly one place**, and a surface that needs a
value the scales do not have adds the step rather than writing the number.

### 5.0 Tier 0: the palette

A plain `:root` block declares the raw inks — `--ink-navy`, `--ink-magenta`, `--ink-charcoal`, and the
rest — named after what they look like. Nothing outside that block may name an ink, and
`check-design-tokens.mjs` enforces it. Re-skinning the product is editing tier 0 and nothing else.

### 5.1 Tier 1: semantic colour

A `@theme` block maps inks onto roles: `--color-canvas`, `--color-surface`, `--color-text`,
`--color-border`, `--color-accent`. This is deliberately not `@theme inline`. Non-inline `@theme` does
two things at once:

1. Generates Tailwind utilities (`bg-surface`, `rounded-md`, `shadow-soft`).
2. Re-emits every token as a custom property on `:root`.

Consequence (2) is what lets the remaining hand-written shell CSS resolve `var(--color-surface)`
unchanged. Consequence (1) combined with non-inline resolution means utilities reference the variable
rather than its value, so a theme flip reaches every utility without a `dark:` variant.

Each role is declared once, for both themes, through `light-dark()`:

```css
--color-surface: light-dark(var(--ink-paper), var(--ink-navy-raised));
```

`light-dark()` resolves against `color-scheme`, so the entire dark mode is three declarations —
`:root { color-scheme: light dark }` plus a `light` and a `dark` override keyed on `[data-theme]`.
This replaced four blocks that restated the same twelve tokens; changing the sidebar colour previously
meant editing three of them and silently getting it wrong in the fourth. A role that is the same ink in
both themes names that ink once, which is itself the documentation.

Tier 1 also holds the derived colours that components used to mix inline:

- `--color-*-tint` and `--color-*-rim` for a severity worn by a panel — the fill and the border of a
  warning or danger card. Six inline `color-mix()` calls at five different percentages became two pairs.
- `--color-surface-glass` and `--color-canvas-glass` for a bar or panel floating over scrolling
  content, paired with `backdrop-blur-lg`.
- `--color-sidebar-text`, `--color-sidebar-text-dim`, `--color-sidebar-text-faint`,
  `--color-sidebar-row`, and `--color-sidebar-rule`, taken as alphas of `--sidebar-fg`. The sidebar is
  a fixed dark chrome in both themes, so its foreground scale is its own group rather than a tint of
  `--color-text`.

### 5.2 Tier 1: the non-colour scales

A second `@theme` block owns type, weight, tracking, leading, radius, elevation, and the breakpoint.
Each namespace is **reset to `initial` before ours is declared**, including `--color-*`. Tailwind's
defaults are built for a page; this is a dense application shell whose body text is 0.75rem, two steps
below a stock `text-sm`. Leaving the defaults in place means every surface silently chooses between two
competing scales. After the reset, an off-scale name generates no class at all — a visible failure
rather than a quiet one.

| Namespace | Steps |
| --------- | ----- |
| `--text-*` | `2xs` 0.58 · `xs` 0.65 · `sm` 0.7 · `base` 0.75 · `md` 0.82 · `lg` 0.88 · `xl` 1.05 · `2xl` 1.15 · `display` (fluid clamp) |
| `--font-weight-*` | `normal` 400 · `medium` 560 · `semibold` 650 · `bold` 750 · `extrabold` 850 |
| `--tracking-*` | `tight` · `tighter` · `tightest` · `wide` · `wider` |
| `--leading-*` | `tight` 1.2 · `snug` 1.35 · `normal` 1.5 · `relaxed` 1.65 |
| `--radius-*` | `xs` 0.4 · `sm` 0.5 · `md` 0.75 · `lg` 1 · `xl` 1.35 · `full` |
| `--shadow-*` | `soft` · `raised` · `popover` · `inset` · `ring` · `ring-sm` · `selected` |

The weight ramp is heavier than Tailwind's because the type is small: at 0.6rem a stock 600 reads as
regular weight. Every type step carries its own `--line-height`, so `text-sm` sets both and a surface
spells out `leading-*` only where it genuinely departs from the step. `--shadow-selected` is the halo
and the lift as one token, because a `box-shadow` utility replaces another rather than adding to it.

Spacing is the one namespace kept at Tailwind's default: a 0.25rem base with half steps already gives
0.125rem resolution, and the migration snapped every off-grid literal onto it.

`--breakpoint-narrow` (51.25rem) is the one viewport at which the shell stops being two columns. The
hand-written shell CSS reads it back with `@media (width <= theme(--breakpoint-narrow))` rather than
repeating `820px`, and the shell's own geometry — `--sidebar-width`, `--sidebar-width-collapsed`, and
the four `--layer-*` stacking tiers — sits beside it.

### 5.3 Tier 2: semantic aliases

A `@theme inline` block maps the shadcn token contract onto tier 1: `--color-background`,
`--color-foreground`, `--color-muted-foreground`, `--color-card`, `--color-primary`,
`--color-primary-foreground`, `--color-destructive`, `--color-ring`.

`inline` is correct here: the alias resolves to `var(--color-*)` at build time and still flips at
runtime. This tier exists so upstream patterns and examples drop in without translation.

### 5.4 Domain tokens

Provider and status colours (`--color-codex`, `--color-claude`, `--color-warning`, `--color-danger`)
stay in tier 1 and are consumed through `data-*` attribute variants. A provider identity is not a
semantic role and must not be aliased into tier 2.

### 5.5 Enforcement

`scripts/check-design-tokens.mjs` runs inside `pnpm check:styles` and fails on a component that writes
a literal size, weight, radius, shadow, or colour instead of a scale step, on a component that names a
tier 0 ink, and on a hex colour anywhere in the stylesheet outside the palette block. Expressions are
not literals: `w-[min(31rem,calc(100vw-2rem))]`, grid track lists, and `em` sizes relative to inherited
type are layout and remain allowed.

The check exists because the failure mode is invisible. A `text-[0.63rem]` beside a `text-xs` renders
fine, reviews fine, and quietly ends the scale's usefulness; the 289 arbitrary utilities this migration
replaced accumulated exactly that way, one reasonable-looking line at a time.

## 6. Component authoring rules

1. Variants are a `cva` table exported from the component's `index.ts`, separately from the component,
   so a non-component consumer can request the same classes. Where one table describes a family
   rather than a component — `controlVariants` in `src/ui/control-variants.ts`, shared by `Input`
   and `NativeSelect` — it lives beside `cn` instead. An input and a select in the same row have to
   be the same object; owning the table twice is how they drift apart.
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

Where the app needs one shape of a primitive rather than its whole surface, a narrow typed contract
is used instead of a forward. `ToggleGroup` declares `modelValue`/`update:modelValue` and fixes
`type="single"` rather than forwarding `ToggleGroupRootProps`, which is a discriminated union over
`type` that no caller here varies. This satisfies the rule's purpose more strictly than forwarding
would: a misspelled handler still fails to compile, and an unsupported mode cannot be requested at
all.

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

Outcome: it did not recur. `DialogContent` remains the only wrapper that forwards a full reka prop
surface. Every other wrapper either takes a narrow typed contract (section 7.3) or forwards only
`as`/`as-child`, so no shared helper was needed.

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
4. Appearance is not covered by any lane. A utility can be present on an element and still not apply
   — the unlayered-reset defect in section 10.3 is the proof — so every migrated surface is opened in
   a real browser and compared against the surface it replaced.

## 10. Delivery status

All five slices have landed. `apps/web/src/shared/styles.css` is 761 lines, down from 2,516, and
holds only tokens, resets, shell layout, rendered-markdown prose, and vue-flow overrides.

### 10.1 Foundation

Dependencies added to `apps/web` at exact pinned versions: `reka-ui` 2.10.1, `@vueuse/core` 14.4.0,
`class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0.

Delivered: `cn`, `Button` with `buttonVariants`, the `Dialog` family, and the two-tier token blocks.
Migrated `features/conversation/Composer.vue` and `views/DraftView.vue`.

`tailwindcss` has been removed from `knip.json`'s `ignoreDependencies`: the suppression existed only
because Tailwind was installed and unused, and `pnpm knip` now reports it as genuinely consumed.

### 10.2 Slice 2: ProjectSidebar

The add-project, command palette, and settings dialogs moved from imperative `showModal()`/`close()`
to reka `Dialog` with `v-model:open`. `DialogClose` joined the barrel; `DialogTrigger` did not,
because no dialog here opens from a plain trigger — each opens from an async flow, a route query, or
a keyboard chord. The manual `keydown` pair became two `onKeyStroke` calls.

`Field`, `FieldHint`, `FieldError`, `Input`, and `NativeSelect` were pulled forward from slice 3:
deleting `.modal` orphans `.modal form`, `.modal label`, `.modal input`, and `.modal select` in the
same commit, and those rules have nowhere to go but a primitive.

Deleted: `.modal` and its six descendant rules, `.modal-heading`, `.modal-actions`,
`.command-palette`, `.palette-actions`, `.palette-projects`, and the whole `.directory-browser` and
`.advanced-fields` families.

Each dialog gained a visually hidden `DialogDescription`. reka always emits `aria-describedby` on
dialog content, so a dialog without a description points at an element that does not exist.

### 10.3 Slice 3: buttons and form controls

Migrated the remaining `.button` and `.icon-button` consumers — `App.vue`, `ThreadHeader.vue`,
`ReviewPanel.vue`, `AgentMap.vue`, `WelcomeView.vue`, `PermissionCard.vue` — and the `DraftView`
form controls. Added `Textarea` and a `size` variant to the shared control box.

This slice found and fixed a defect the foundation had shipped: the resets were unlayered, and an
unlayered `button { font: inherit }` beats every Tailwind utility regardless of specificity, because
utilities live in the `utilities` cascade layer. Every `Button` had been rendering at the inherited
16px rather than its variant's size since the foundation landed, with no signal — the same failure
mode as the undefined `.quiet` class in section 2.2. The resets now sit in `@layer base`.

### 10.4 Slice 4: display primitives and delegated behavior

Added `Card` (polymorphic, with a `warning` tone), `StatusBadge`, `Eyebrow`, `EmptyState`, and
`ProviderMark`. Migrated `PermissionCard.vue`, `Transcript.vue`, `AgentTree.vue`, and the
`.tool-card` family.

`StatusDot` was specified but is not shipped: `.status-dot` had no consumer in any component, so it
was deleted rather than reimplemented. The dot inside a status badge is now part of `StatusBadge`
rather than markup each caller repeats.

`DialogEyebrow` was replaced by `Eyebrow`. A dialog eyebrow and a panel eyebrow were the same
element with the same styling, which is the duplication this library exists to remove.

reka `Collapsible` now backs the sidebar project groups, so `.project-chevron` — previously a caret
that did nothing — is a real disclosure with `aria-expanded`. reka `ToggleGroup` backs the surface
switch and the map view toggle; both keep `role="group"` and `aria-pressed` exactly as before and
gain roving tabindex, so no test or accessible name changed.

### 10.5 Slice 5: the remaining surfaces

A selector sweep removed 27 class families that had no markup left anywhere — `.project-heading`,
`.project-label`, `.new-chat-button`, `.thread-search`, `.welcome-orbit`, and the rest of the
pre-redesign vocabulary, including their `.sidebar.collapsed` and narrow-viewport variants.

The remaining feature surfaces were then migrated to token-backed utilities: the review panel, the
agent map and its inspector, the transcript, the composer, the draft view, the welcome view, and the
thread header.

Shell layout stayed hand-written, as section 10.5 of the original plan allowed. It now consumes
tokens throughout rather than repeating `rgb(244 247 240 / …)` literals.

## 11. Ratchet

Status: implemented. `scripts/check-stylesheet-ratchet.mjs` and `scripts/check-design-tokens.mjs` run
as `pnpm check:styles` inside `pnpm check`.

The ratchet is strict in both directions. Exceeding the ceiling fails, and so does falling under it,
with an instruction to lower the constant. A one-directional ratchet lets a deletion go unrecorded,
which leaves headroom for the next rule to be added silently.

The ceiling was seeded at 2,493 before slice 2 landed, fell to 761, and now stands at **872**. The
token restructure is the one deliberate rise: the type, weight, tracking, leading, and elevation scales
moved into this file precisely so that no component declares them, and the token check enforces that
they stay there. A token block growing is the system working; a rule block growing is not, and the two
checks together are what distinguishes the cases.

## 12. Acceptance criteria

| # | Criterion | Status |
| - | --------- | ------ |
| 1 | No component declares a colour, radius, or shadow value outside the token blocks | Met, and now enforced |
| 1a | No component declares a font size, weight, tracking, or leading value either | Met, enforced by `check-design-tokens.mjs` |
| 2 | Every primitive accepts and last-merges a `class` prop | Met |
| 3 | Focus, portal, and roving-tabindex behavior is delegated to reka-ui | Met |
| 4 | `ui` imports nothing from `shared`, `features`, or `views` | Met |
| 5 | No native `<dialog>` remains in `apps/web` | Met |
| 6 | `.button`, `.icon-button`, `.modal`, `.send-button`, `.composer-control` are absent | Met |
| 7 | `shared/styles.css` contains only tokens, resets, shell layout, and third-party overrides | Met, with one documented addition |
| 8 | Every slice landed without modifying a test to accommodate markup | Met — no test file was changed |
| 9 | `pnpm check`, `pnpm knip`, and `pnpm test:e2e:web` pass at every slice boundary | Met |

### 12.1 Amendment to criterion 7

The stylesheet also retains the `.markdown` rules, roughly 30 lines that style the output of
`renderMarkdown`. This is not an exception that can be closed by trying harder: the content is
injected with `v-html`, so no utility class can reach the `<p>`, `<code>`, or `<pre>` elements
inside it. Styling rendered prose from a stylesheet is the same reason Tailwind ships a typography
plugin rather than utilities for it.

Criterion 7 is therefore amended to read: **tokens, resets, shell layout, rendered-markdown prose,
and third-party overrides**. Prose rules must consume tokens and must not be extended to cover
anything a component could style itself.

## 13. Definition of done per slice

- The stylesheet rules whose last consumer the slice removed are deleted in the same commit.
- The ratchet ceiling is lowered to the new line count.
- No test file is modified, or the product reason for each modification is stated.
- Light and dark themes, keyboard traversal, focus visibility, narrow viewport, and reduced motion are
  verified for every migrated surface.
- New user-visible copy is in the message catalog.
- `pnpm check` passes, plus `pnpm test:e2e:web` when a migrated surface is on an end-to-end journey.

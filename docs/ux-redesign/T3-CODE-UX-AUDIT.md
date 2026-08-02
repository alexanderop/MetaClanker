# T3 Code interaction audit

This audit records interaction evidence used to evaluate existing MetaClanker features. It compares
behavior and hierarchy, not T3 Code's artwork, copy, brand, assets, or product-only capabilities.

## Evidence labels

- **Observed** — exercised directly in the installed T3 Code app through Computer Use.
- **Bundle-verified** — verified read-only in the installed build's source map because Computer Use
  could not traverse the flow.
- **Not executed** — a consequential endpoint was deliberately not exercised.

Bundle evidence is never promoted to Observed. A MetaClanker change based only on bundle evidence
must retain that limitation in `tmp/progress.md`.

## Findings

### Command-palette entry and keyboard reachability

- Date: 2026-08-02
- Evidence: **Observed**
- Flow: Open the sidebar Search control in `T3 Code (Alpha)`, inspect the command palette, and close
  it with Escape without executing a command.
- Finding: The sidebar exposes a plainly labelled Search control with `⌘K`. Activating it opens a
  focused command/search field, selects the first action, groups actions separately from recent
  threads, and shows compact `Navigate`, `Enter Select`, and `Esc Close` keyboard help.
- Scope for MetaClanker: Align discoverability and immediate keyboard feedback for MetaClanker's
  existing command palette. Search across threads and projects is not an existing MetaClanker
  capability and remains backlog-only.
- Screenshot: [T3 command palette observed](evidence/2026-08-02-t3-command-palette-observed.jpeg)

MetaClanker now exposes a translated Search conversations entry with the platform shortcut. In the
2026-08-02 built Electron app, activating it opened the existing palette with New chat focused.
[Electron verification screenshot](evidence/2026-08-02-metaclanker-command-palette-electron.jpeg)

### Add-project entry and handoff

- Date: 2026-08-02
- Evidence: **Observed** for the T3 entry; **Not executed** for T3's project-selection endpoint.
- Finding: T3 keeps New project as a top-level sidebar action beside New thread and the project
  filter. The endpoint was not opened because T3 is read-only for this audit.
- MetaClanker comparison: The isolated browser uses its required constrained server directory
  browser, then routes directly to a new draft with the composer focused. The built Electron app
  opens the native picker immediately and performs the same focused handoff without a redundant
  confirmation form.
- Screenshots: [T3 New project entry](evidence/2026-08-02-t3-new-project-entry-observed.jpeg),
  [MetaClanker native-picker handoff](evidence/2026-08-02-metaclanker-add-project-electron.jpeg)

### Contextual new conversation

- Date: 2026-08-02
- Evidence: **Observed**
- Finding: T3's global New thread action opens a searchable project chooser, preselects the first
  project, and exposes number-key hints. It does not create or send anything until the user selects
  a project and later submits a prompt.
- MetaClanker comparison: The global action takes the current/recent project immediately, while the
  sidebar still offers explicit per-project actions and the draft retains a project switcher. Both
  the isolated browser and the built Electron app routed directly to the scratch project draft with
  the composer focused.
- Decision: **Deliberately different.** MetaClanker's contextual default removes a chooser without
  removing project control.
- Screenshots: [T3 project chooser](evidence/2026-08-02-t3-new-thread-project-chooser.jpeg),
  [MetaClanker contextual draft](evidence/2026-08-02-metaclanker-contextual-new-chat-electron.jpeg)

### Sidebar visibility and persistence

- Date: 2026-08-02
- Evidence: **Observed** for T3 hide/show; resize endpoint not executed.
- Finding: T3 exposes a main-sidebar toggle and a separate resize control. The toggle changes its
  pressed value immediately and remains keyboard reachable.
- MetaClanker comparison: Collapse/expand already provided immediate focus feedback and survived a
  same-origin browser reload. The first Electron relaunch failed: a new dynamic loopback port changed
  the storage origin and lost the collapsed state.
- Change: A narrow, sender-validated desktop bridge now persists only `sidebarCollapsed` in a
  mode-0600 application-data file and supplies the initial value to the sandboxed preload. Browser
  behavior retains its existing localStorage fallback. No general persistence or filesystem API was
  added.
- Verification: The packaged smoke runs two isolated app launches and checks both server children;
  Computer Use saw collapse on port `55817` and restored collapse on port `55859`.
- Screenshots: [T3 toggle](evidence/2026-08-02-t3-sidebar-toggle-observed.jpeg),
  [MetaClanker restored Electron state](evidence/2026-08-02-metaclanker-sidebar-restored-electron.jpeg)

### Project and conversation navigation

- Date: 2026-08-02
- Evidence: **Observed**
- Finding: Selecting a T3 conversation changes the main heading and project-scoped New thread
  action. The sidebar row retains the project name, compact age, and thread actions. Snooze and
  settle are T3-only capabilities and were not executed.
- MetaClanker comparison: The isolated browser exposed a native disclosure button, nested thread
  link, compact relative age, live status in the accessible name, and `aria-current="page"` on the
  selected conversation. A focused Chromium regression verifies that Enter expands the disclosure.
- Electron verification: In the fresh built app, Return re-expanded the focused project disclosure.
  Opening a project-scoped draft and then selecting the completed scratch conversation restored the
  matching heading, completed status, transcript, and focus on the selected thread link.
- Decision: **Aligned.** No production change was required; the new browser contract protects the
  keyboard path that was previously implicit.
- Screenshots: [T3 conversation selection](evidence/2026-08-02-t3-conversation-selection-observed.jpeg),
  [MetaClanker Electron navigation](evidence/2026-08-02-metaclanker-conversation-navigation-electron.jpeg)

### Empty workspace onboarding

- Date: 2026-08-02
- Evidence: **Bundle-verified** for T3's zero-project branch. T3 project creation was not executed,
  so no zero-project screenshot is presented as observed evidence.
- Finding: The installed source map's `SidebarV2` renders `No projects yet` with an Add project
  action when the catalog is empty. Its `NoActiveThreadState` gives the main surface a short
  pick-or-create prompt. The top-level New project entry was separately observed during the
  add-project pass.
- MetaClanker comparison: The empty isolated browser and a fresh Electron profile both rendered a
  labelled `What should we work on?` region, explicit local-directory guidance, a dominant Add
  project action, and a secondary settings route. Electron opened the native picker immediately and
  restored focus to Add project after cancel.
- Decision: **Aligned.** No production change was required; a focused browser contract now protects
  the zero-project hierarchy and its direct onboarding handoff.
- Screenshot: [MetaClanker empty Electron workspace](evidence/2026-08-02-metaclanker-empty-workspace-electron.jpeg)

### Local draft persistence

- Date: 2026-08-02
- Evidence: **Bundle-verified** for T3. Entering a draft was not executed because this audit keeps
  T3's local state read-only.
- Finding: T3's installed source map shows draft lookup by logical project key, restoration onto a
  draft route, and stored prompt/model/runtime controls consumed by the composer.
- MetaClanker pre-change result: A browser hard reload retained prompt, model, effort, permission,
  cursor, and composer focus. Electron did not: a draft created at loopback `58362` returned empty
  with default controls after relaunch at `58468`, exposing an origin-scoped localStorage defect.
- Change: Electron now exposes dedicated sender-validated draft read/write operations. Draft JSON is
  payload-bounded, written serially to a separate mode-0600 application-data file, and flushed at
  shutdown. The renderer performs the authoritative Effect Schema decode. Prompt and attachment
  data never enters arguments, logs, errors, or a generic storage API; browser localStorage remains
  unchanged.
- Verification: The packaged smoke failed before the change on its second launch, then passed with
  prompt, model, effort, permission, cursor, focus, both server children, and shutdown verified.
  Computer Use then saw the same fields and composer focus restored across `59065` → `59164`.
- Decision: **Aligned.** The feature now survives the shipping Electron topology rather than only a
  same-origin browser remount.
- Screenshot: [MetaClanker restored Electron draft](evidence/2026-08-02-metaclanker-draft-restored-electron.jpeg)

### Draft project switching

- Date: 2026-08-02
- Evidence: **Observed**
- Finding: T3's New thread action opens a focused project chooser with immediate selection and
  keyboard hints. This is the target interaction pattern for changing project context before send;
  no project was selected in T3.
- MetaClanker comparison: Its draft keeps the project control inline. In the isolated browser,
  choosing Add project registered a second scratch Git directory, selected its blank focused draft,
  and switching between projects restored two independent prompts plus the first project's model,
  effort, and permission controls. Fresh Electron verification reproduced the native picker handoff,
  independent drafts, immediate switching, and composer-focus restoration.
- Decision: **Aligned.** MetaClanker's inline control is deliberately contextual but matches the
  target's immediacy and preserves more draft context. No production change was required; a focused
  browser contract now protects independent per-project restoration.
- Screenshots: [T3 project chooser](evidence/2026-08-02-t3-new-thread-project-chooser.jpeg),
  [MetaClanker Electron project switcher](evidence/2026-08-02-metaclanker-draft-project-switcher-electron.jpeg)

### Draft discard safety

- Date: 2026-08-02
- Evidence: **Bundle-verified** for T3. Creating and abandoning a real T3 draft was not executed.
- Finding: The installed bundle clears composer content after successful send and clears associated
  draft state when a project or thread is deleted, but no equivalent explicit unsent-draft discard
  surface was found. Those destructive project/thread operations have their own confirmation rules
  and are not treated as direct parity evidence.
- MetaClanker comparison: An empty draft exits immediately. A draft with content opens a labelled
  confirmation dialog with Keep draft focused; cancelling preserves the prompt and restores focus to
  the Discard draft trigger. Confirmation returns to the start surface, and reopening the project
  produces a blank focused composer.
- Decision: **Deliberately different.** Persistent per-project MetaClanker drafts need an explicit,
  safe clearing path even though T3 does not expose a directly comparable control. A focused browser
  contract now protects both the low-ceremony empty path and the guarded non-empty path.
- Electron verification: A fresh process at `61461` opened the persisted scratch draft's confirmation
  dialog with Keep draft focused. Keep retained `SECOND ELECTRON PROJECT DRAFT` and restored focus to
  the Discard draft trigger. The final deletion endpoint was not executed through Computer Use; the
  focused browser regression owns confirmed clearing and blank/focused reopen.
- Screenshot: [MetaClanker Electron discard confirmation](evidence/2026-08-02-metaclanker-draft-discard-electron.jpeg)

### Provider selection and unavailable feedback

- Date: 2026-08-02
- Evidence: **Observed**
- Finding: T3 keeps its provider/model control adjacent to the prompt and displayed a visible Codex
  provider failure over the transcript while preserving the composer. No prompt or provider endpoint
  was executed.
- MetaClanker pre-change result: Its selected unavailable provider already produced a status message
  and disabled send, but another unavailable choice only read `unavailable` inside the provider
  control, omitting the readiness reason at the decision point.
- Change: Provider names and unavailable-option copy now come from i18n. A disabled provider option
  includes its concrete readiness reason; choosing a ready alternative clears the status and enables
  send when the draft has content.
- Verification: The focused browser regression failed before the change on the missing option reason
  and then passed in the 14/14 feature file and the full `pnpm check`. The real isolated browser kept
  the native Provider control focused while switching from Codex to Claude. A fresh Electron process
  at `61461` repeated the Codex-to-Claude switch while retaining the persisted prompt, enabled send,
  and returned focus to Provider.
- Screenshot: [T3 provider failure and composer controls](evidence/2026-08-02-t3-conversation-selection-observed.jpeg)
- Electron screenshot: [MetaClanker provider selection](evidence/2026-08-02-metaclanker-provider-selection-electron.jpeg)

### Searchable model catalog

- Date: 2026-08-02
- Evidence: **Observed** for the T3 chooser; model selection and provider endpoints were not executed.
- Finding: T3's composer model control opens a focused searchable chooser with Provider default,
  provider sections, favorites, unavailable-provider reasons, visible model results, and a custom
  model fallback. Escape closed it without changing T3 state.
- MetaClanker pre-change result: The existing inline model field supported provider default and any
  custom identifier, but it did not expose a catalog or help users discover values previously
  advertised by their local adapter.
- Change: The inline field remains for low-ceremony custom input and now has a Browse catalog trigger.
  The dialog focuses Search models, filters ACP-advertised and recent/custom values, exposes Provider
  default, and accepts a new custom identifier. Selection closes the dialog and restores focus to the
  trigger. Provider choice and unavailable reasons stay in the adjacent Provider control.
- Architecture: A draft never opens a provider session for discovery. When a real session opens, the
  ACP client's normalized `capabilities.models` replaces a provider-scoped SQLite cache; the public
  readiness wire contract carries only those identifiers, and opening the catalog refreshes that
  readiness response. An empty cache is labelled honestly. No Codex- or Claude-specific catalog is
  hardcoded outside `packages/acp-client`.
- Verification: The browser test failed before the change because the catalog trigger was absent,
  then passed in focused 15/15 coverage, the full `pnpm check`, and packaged Electron smoke. ACP contract coverage verifies
  config-option extraction; persistence and orchestrator integration verify provider isolation,
  replacement/deduplication, restart retention, and caching after a real fake-ACP session opens. The
  real dev browser accepted `browser-catalog-model` and restored trigger focus.
- Electron verification: A fresh built process at `63679` opened the persisted Claude draft with
  Search models focused, filtered to `Use custom model electron-catalog-model`, applied it while
  retaining the prompt, and restored focus to Browse catalog. After the readiness-refresh addition,
  the final rebuilt app at `64288` reopened the retained model with Search models focused and again
  restored Browse catalog focus after selection; the screenshot comes from this final build.
- Decision: **Aligned.** Favorites are a T3-only preference feature and remain out of scope; the
  existing MetaClanker model contract now has equivalent discovery, search, default, custom, and
  keyboard/focus quality without violating the draft or provider boundary.
- Screenshots: [T3 model chooser](evidence/2026-08-02-t3-model-chooser-observed.jpeg),
  [MetaClanker Electron model catalog](evidence/2026-08-02-metaclanker-model-catalog-electron.jpeg)

### Effort selection

- Date: 2026-08-02
- Evidence: **Observed** in both apps; no T3 value was changed.
- Finding: T3 groups Reasoning, Context Window, and Fast Mode in a focused popover. Its reasoning
  choices were Low, Medium, High, Max, and Ultrathink; Escape restored focus to the trigger.
- MetaClanker result: The existing compact native select exposes the one provider-neutral effort
  dimension currently supported by the product: provider default, Low, Medium, and High. Selection
  is immediate and keeps the rest of the per-project draft intact.
- Verification: The browser contract covers keyboard reachability, explicit High, prompt retention,
  returning to Default, and resolution to Claude's configured Low default. The real dev browser
  retained a verification prompt with High selected and Effort focused. A fresh built Electron app
  at `65469` exposed all four choices, retained the persisted prompt/provider/model when High was
  selected, returned focus to Effort, and was restored to Default. The full `pnpm check` passed.
- Decision: **Aligned.** Context-window and fast-mode controls are T3-only capabilities. Adding them
  without normalized ACP metadata would create provider-specific UI rather than improve parity for
  MetaClanker's existing effort feature.
- Screenshots: [T3 effort menu](evidence/2026-08-02-t3-effort-menu-observed.jpeg),
  [MetaClanker Electron effort selection](evidence/2026-08-02-metaclanker-effort-selection-electron.jpeg)

### Permission mode

- Date: 2026-08-02
- Evidence: **Observed** in both apps; no T3 value was changed.
- Finding: T3's Runtime mode chooser describes Supervised, Auto-accept edits, Auto, and Full access
  in terms of which commands and edits require approval. Escape restored focus to the control.
- MetaClanker pre-change result: Default, Read only, Workspace write, and Full access were compact and
  keyboard-operable, but their authority was communicated only by name.
- Change: A visible translated line now explains the selected mode and updates immediately. The select
  references that line through `aria-describedby`; provider defaults remain authoritative.
- Verification: The browser regression covers default guidance, explicit Read only, retained prompt
  and focus, provider handoff, and Workspace write guidance. Real dev-browser and rebuilt Electron
  passes selected Full access, retained draft context, displayed the unsandboxed warning immediately,
  restored focus, and returned the scratch draft to Default. `pnpm check` passed with 31/31 browser tests.
- Decision: **Aligned.** MetaClanker keeps its normalized ACP vocabulary while matching T3's explicit
  risk communication at the decision surface.
- Screenshots: [T3 runtime mode](evidence/2026-08-02-t3-runtime-mode-observed.jpeg),
  [MetaClanker Electron permission mode](evidence/2026-08-02-metaclanker-permission-mode-electron.jpeg)

### Draft attachments

- Date: 2026-08-02
- Evidence: **Observed** in both apps; T3 paste/drop and send endpoints were not executed.
- Finding: T3's follow-up placeholder explicitly advertises attached images, but no separately named
  attachment button appeared in the accessibility tree. MetaClanker's existing feature is different:
  it sends server resource URIs as ACP resource links before the first prompt.
- MetaClanker pre-change result: The reveal was compact and chips were removable, but focus stayed on
  the trigger, empty/relative/duplicate input failed silently, and the wire contract accepted strings
  that the UI described as URIs.
- Change: Reveal now focuses the input with a native autofocus fallback for Electron. Invalid absolute
  URIs and duplicates receive translated inline alerts; successful add/remove restores input focus.
  Start and follow-up wire schemas enforce the same absolute Resource URI contract.
- Verification: The browser regression failed before the focus fix, then covered empty/relative,
  valid add, duplicate, send readiness, remove, storage deduplication, and focus. The wire contract
  accepts `file:` and `urn:` and rejects relative/malformed values. Real dev-browser and final Electron
  passes exercised the same safe flow without sending. `pnpm check` passed with 32/32 browser and 7/7
  contract tests.
- Electron verification: A rebuilt app at `54137` exposed an Electron-only missing-focus failure.
  After the autofocus fallback, the final app at `54364` focused the URI input on reveal, rejected
  `notes.md`, added one `file:///srv/electron-attachment.md` chip, explained the duplicate, removed the
  chip, and returned focus to the input.
- Decision: **Aligned.** Image paste/drop remains a T3-only capability; MetaClanker's existing
  provider-neutral server-resource flow now has equivalent validation, feedback, and focus quality.
- Screenshots: [T3 attachment affordance](evidence/2026-08-02-t3-attachment-affordance-observed.jpeg),
  [MetaClanker Electron attachments](evidence/2026-08-02-metaclanker-draft-attachments-electron.jpeg)

### First send

- Date: 2026-08-02
- Evidence: **Observed** in both apps; T3 send endpoint was not executed. MetaClanker endpoint evidence
  used the deterministic fake ACP against scratch projects only.
- Finding: T3 keeps prompt, model, effort, runtime, mode, attachment context, and send action adjacent;
  empty input visibly disables Send. MetaClanker's existing contract additionally guarantees that no
  durable thread or provider session exists until the first accepted send.
- MetaClanker pre-change result: Readiness, Enter/Shift+Enter, stable command identity, rejection
  preservation, and one-time promotion already worked. Pending submission only disabled controls,
  without visible status, and Electron did not focus the promoted composer.
- Change: Pending first send now shows and announces `Starting conversation…`; the disabled action is
  named `Sending message`. The promoted thread composer has a native autofocus fallback for Electron.
- Verification: The new browser test failed before pending feedback existed, then covered Shift+Enter,
  the real request-start milestone, pending status/disabled controls, successful promotion, and focus.
  Existing coverage proves accepted-once and rejection retry with the same command ID and every draft
  field retained. Real `pnpm dev` with fake ACP promoted and completed a safe scratch prompt, updated
  sidebar/header state, rendered both messages, and focused the composer.
- Electron verification: At `55269`, fake-ACP promotion completed but exposed missing composer focus.
  After the autofocus fallback, final build `55607` promoted once, rendered the safe user message and
  `FIRST_SEND_ELECTRON_FOCUS_OK`, reached Completed, and focused the follow-up composer.
- Decision: **Aligned.** Pending, success, rejection, draft safety, stable identity, keyboard use, and
  focus transition are now explicit without executing a real provider or mutating project files.
- Screenshots: [T3 send affordance](evidence/2026-08-02-t3-first-send-affordance-observed.jpeg),
  [MetaClanker Electron first send](evidence/2026-08-02-metaclanker-first-send-electron.jpeg)

### Follow-up composer

- Date: 2026-08-02
- Evidence: **Observed** in both apps; the T3 endpoint was not executed. MetaClanker endpoint evidence
  used deterministic fake ACP against scratch projects only.
- Finding: T3 keeps its bottom prompt and adjacent model, effort, runtime, mode, attachment, and send
  controls dense and immediately reachable. MetaClanker's existing provider-neutral follow-up surface
  keeps provider/model context visible and replaces Send with Stop while a turn is active.
- MetaClanker pre-change result: Enter, Shift+Enter, thread-local drafts, accepted follow-ups, and Stop
  existed. A follow-up cleared its stored draft before HTTP acceptance, exposed no pending or rejection
  feedback, generated a new command ID on retry, and lost focus after navigation or successful send.
- Change: The composer now shows and announces `Sending follow-up…`, names its disabled action
  `Sending message`, retains and explains a rejected message, restores focus after navigation/failure/
  success, and reuses the draft's command ID until a send is accepted. Agent-setting copy is translated.
- Verification: The new fail-before test covers Shift+Enter without a request, typed request-start
  pending state, rejection, visible error, draft/navigation retention, same-ID retry, successful clear,
  and focus. A second browser contract proves that an active turn retains typed text, hides Send, exposes
  Stop, and issues exactly one cancel mutation. The browser suite is 35/35 and `pnpm check` passed.
- Real browser verification: In `Parity Scratch`, fake ACP showed pending text and Stop together, then
  rendered the second user/agent pair, reached Completed, cleared the draft, and focused the composer.
- Electron verification: Fresh build `57916` sent a second safe turn in an existing scratch project,
  rendered `FOLLOW_UP_ELECTRON_OK`, reached Completed, cleared the draft, and focused the composer.
- Decision: **Aligned.** Pending, active, rejection, retry, success, keyboard, focus, draft safety, and
  stable mutation identity are explicit without running a real provider or modifying project files.
- Screenshots: [T3 follow-up affordance](evidence/2026-08-02-t3-first-send-affordance-observed.jpeg),
  [MetaClanker browser follow-up](evidence/2026-08-02-metaclanker-follow-up-browser.jpeg),
  [MetaClanker Electron follow-up](evidence/2026-08-02-metaclanker-follow-up-electron.jpeg)

### Transcript message hierarchy

- Date: 2026-08-02
- Evidence: **Observed** in both apps; this was a read-only pass and no T3 endpoint was executed.
- Finding: T3 separates user prompts, agent output, tool failures/groups, timestamps, worked-time,
  changed-file summaries, and message actions into a compact chronological stream. MetaClanker's
  existing provider-neutral stream already separated user bubbles, frameless agent output, collapsed
  thought/tool activity, sticky tail-following, and bounded older-history disclosure.
- MetaClanker pre-change result: Role hierarchy, disclosure, chronological interleaving, and 200-item
  paging were sound. Messages and tool activity did not show their existing timestamps; every tool
  disclosure shared the generic accessible name `Activity`; several transcript strings bypassed i18n.
- Change: Every message now shows local time with a `Sent at …` accessible label. Tool activity shows
  updated time and receives the specific name `Activity: {title}`. Transcript, paging, role, thought,
  timing, and completion copy now come from the translation catalog.
- Verification: The new browser regression failed before timestamps existed, then covered timestamped
  role hierarchy, named activity/status, and collapsed/expanded thought content. Existing tests continue
  to prove tool-only activity does not show an empty state and 205 entries disclose older activity in
  a bounded page. The complete browser suite is 36/36 and `pnpm check` passed.
- Real browser verification: The completed four-message `Parity Scratch` transcript displayed local
  times on every user/agent entry while retaining status, ordering, and composer focus.
- Electron verification: Fresh build `59665` displayed the same four times plus `Sent at …` accessibility
  labels in the safe two-turn Electron thread; Completed state and composer focus remained intact.
- Decision: **Aligned.** MetaClanker's existing hierarchy now provides equivalent scan timing and named
  disclosure. T3-only worked-time, file summary, copy/revert, and deep-link actions remain backlog.
- Screenshots: [T3 transcript hierarchy](evidence/2026-08-02-t3-transcript-hierarchy-observed.jpeg),
  [MetaClanker browser transcript](evidence/2026-08-02-metaclanker-transcript-browser.jpeg),
  [MetaClanker Electron transcript](evidence/2026-08-02-metaclanker-transcript-electron.jpeg)

### Live thread status

- Date: 2026-08-02
- Evidence: **Observed** in both apps. T3 was kept read-only; its active surface exposed a visible,
  dismissible runtime-stream failure. MetaClanker endpoint evidence used deterministic fake ACP in
  scratch projects only.
- Finding: Both products keep the current thread state visible in the navigation and active surface.
  MetaClanker's state is a durable provider-neutral contract shared through shell and thread events.
- MetaClanker pre-change result: Synthetic live events updated header and sidebar without a reload,
  but status values were raw identifiers. A real ACP permission request persisted its card and agent
  node while leaving the thread incorrectly at Running; responding did not publish the return to
  Running before provider completion.
- Change: Header and sidebar now share translated status labels. Permission ingestion durably publishes
  Needs input. An accepted response publishes Running before the provider can resume, preserving
  `needs-input -> running -> terminal` order. Missing or uncertain response delivery moves the thread
  to Recovery required instead of leaving a misleading waiting state.
- Verification: The production-supervisor integration regression timed out before Needs input existed,
  then passed through the real fake-ACP subprocess, permission response, Running event, resolved
  interaction, and Completed result. The browser regression covers Needs input and Completed in both
  header and sidebar without reload. Browser is 36/36 and full `pnpm check` passed.
- Real browser verification: A new `Parity Scratch` turn showed Needs input simultaneously in header
  and sidebar with the permission card; Allow once completed the same turn without reload.
- Electron verification: Fresh build `62086` showed Needs input in both surfaces alongside
  `LIVE_STATUS_ELECTRON` and the permission card, then Completed after Allow once.
- Decision: **Aligned.** MetaClanker's existing state machine now provides immediate, human-readable,
  durable feedback across both surfaces. Stale permission-card cleanup after cancellation remains
  explicitly owned by the later permission/cancellation passes.
- Screenshots: [T3 active error state](evidence/2026-08-02-t3-transcript-hierarchy-observed.jpeg),
  [MetaClanker browser live status](evidence/2026-08-02-metaclanker-live-status-browser.jpeg),
  [MetaClanker Electron live status](evidence/2026-08-02-metaclanker-live-status-electron.jpeg)

### Permission request card

- Date: 2026-08-02
- Evidence: T3 current UI was inspected read-only and had no open request. The installed extracted
  bundle was **Bundle-verified**; its consequential response endpoint was **Not executed**.
  MetaClanker endpoint evidence used deterministic fake ACP in scratch projects only.
- Finding: T3 replaces the composer header with a pending-approval summary, optional command/file
  detail, a queue count, and Cancel, Decline, session-wide, and one-time actions. MetaClanker keeps
  the provider request in the transcript and renders every option actually advertised through ACP.
- MetaClanker pre-change result: The warning hierarchy, detail, and provider options were sound, and
  choices disabled during a local request. A rejected response had no visible feedback and generated
  a new command ID on retry. Cancelling a permission-blocked turn left its pending card durable and
  visible even after the thread reached Cancelled.
- Change: Response dispatch now has an announced pending state, retained-card error feedback, and a
  stable command identity per interaction/option. Turn completion tracks provider interactions and
  marks any still-pending request Cancelled or Stale, publishing the committed interaction event so
  the card disappears without reload.
- Verification: The browser regression failed before pending feedback existed, then proved disabled
  choices, concrete rejection feedback, enabled retry with the same command ID, and resolved removal.
  The production-supervisor integration failed before cancellation cleanup, then proved a real fake-ACP
  request finishes with thread and interaction both Cancelled. Browser is 37/37 and full `pnpm check`
  passed.
- Real browser verification: `Parity Scratch` displayed title, detail, Allow once, Reject, and Needs
  input; Stop reached Cancelled and removed the card immediately.
- Electron verification: Fresh build `63618` displayed `PERMISSION_CARD_ELECTRON` and the same card;
  Allow once removed it and completed the turn.
- Decision: **Aligned.** MetaClanker's provider-neutral card now matches T3's pending, responding,
  failure, resolution, and terminal-cleanup quality. A session-wide choice is intentionally not
  synthesized when the provider does not advertise one.
- Screenshots: [MetaClanker browser permission](evidence/2026-08-02-metaclanker-permission-card-browser.jpeg),
  [MetaClanker Electron permission](evidence/2026-08-02-metaclanker-permission-card-electron.jpeg)

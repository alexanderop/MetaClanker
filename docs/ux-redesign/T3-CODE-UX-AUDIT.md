# T3 Code alpha UX/UI audit

- Audit date: 2026-08-01
- Installed build: T3 Code (Alpha) 0.0.13 (`2a237c20019a`)
- Platform: macOS
- Purpose: document T3 Code's identifiable user flows and the interaction lessons relevant to
  MetaClanker. This is product research, not a proposal to copy T3 Code's visual design or product
  scope.

## 1. Method and evidence levels

The app was opened and exercised with macOS Computer Use. The direct pass covered launch and resume,
the shell, project and thread navigation affordances, a new-thread draft, composer controls, window
resizing, native menus, About, Settings entry points, update entry points, and keyboard/accessibility
behavior.

The installed Electron renderer exposes only two unnamed generic containers to macOS accessibility.
Its projects, threads, composer, toolbar, and settings link have no accessible roles, names, values, or
actions. Coordinate input was also unavailable for this window through Computer Use. Native menu items
were reachable, but `Settings...` returned to the unchanged draft and the configured renderer shortcuts
did not produce an observable state change through the accessibility focus surface.

To avoid claiming that one visible screen represented the whole product, the remaining flow inventory
was verified read-only against the source map shipped inside this exact installed build. Findings use
these labels:

- **Observed**: seen or exercised directly in the running app.
- **Bundle-verified**: the UI, copy, and state handling exist in the installed build, but the flow could
  not be traversed reliably with Computer Use.
- **Not executed**: a consequential endpoint such as sending a prompt, changing files, running a shell
  command, committing, pushing, creating a PR, or deleting data.

This is therefore an inventory of all identifiable flows in build 0.0.13, not a claim that every
provider, repository, error, and destructive endpoint was executed.

## 2. Executive assessment

T3 Code's core product decision is excellent: it opens on intent, not administration. A project-scoped
`New thread` is already a lightweight draft, and the user can set model, reasoning effort, interaction
mode, permission mode, environment, and branch around the same composer before sending. Advanced tools
stay progressively disclosed in the header, side panels, menus, and keyboard shortcuts.

The visual execution is polished but too quiet. The app uses a restrained dark canvas, compact type,
thin borders, and low-chroma controls consistently, yet much of the functional hierarchy approaches
invisibility. Empty-state copy, timestamps, placeholder text, icons, and disabled states have very low
contrast. The 20-pixel-scale icon actions are hard to discover, and several different concepts are
represented by tiny chevrons or plus buttons.

The largest issue is accessibility. The renderer is effectively opaque to assistive technology in the
audited build. That blocks screen-reader discovery and made keyboard-path verification unreliable. A
second reproducible issue appeared when the app was restored from maximized to a 1082 x 768 window: the
composer and right-side header actions fell outside the visible work surface, leaving only a thin edge
of the composer at the bottom. Maximizing the window restored them.

Overall:

| Dimension                  | Assessment                                      |
| -------------------------- | ----------------------------------------------- |
| Intent-first creation      | Excellent                                       |
| Information architecture   | Strong and compact                              |
| Advanced workflow coverage | Exceptionally broad                             |
| Progressive disclosure     | Strong                                          |
| Visual hierarchy           | Elegant, but too subdued                        |
| Discoverability            | Mixed                                           |
| Safety copy                | Strong in implemented dialogs                   |
| Responsive resilience      | Weak in the reproduced windowed state           |
| Accessibility              | Critical failure in the audited build           |
| Alpha feedback/recovery    | Mixed; several actions give no visible response |

## 3. Observed shell and visual system

### 3.1 Application shell — Observed

The desktop shell has three stable regions:

1. A narrow project/thread tree on the left.
2. A thread header and large transcript canvas in the center.
3. A centered composer anchored near the bottom, with environment and branch immediately below it.

The visible draft belonged to `specplanner`. The shell showed existing projects and prior threads,
including relative recency, while the main canvas said `Send a message to start the conversation.` The
header identified `New thread` and the active project.

The layout feels calm and immediately legible to an experienced coding-agent user. The left-to-right
model—project, conversation, work surface—is conventional and efficient. It also uses the viewport
well when maximized.

Weaknesses:

- The primary work surface has almost no visible onboarding beyond a very faint sentence.
- The selected project and current thread relationship relies heavily on position and subtle color.
- Sidebar timestamps such as `132d ago` have very low contrast and compete poorly with titles.
- The add-project plus is separated from a visible label and is easy to confuse with thread creation.
- The project status dot has no visible legend.
- At 1082 x 768, the composer and right header actions became effectively inaccessible below/outside the
  visible layout. This is a release-blocking narrow-window regression.

### 3.2 Visual language — Observed

The app uses DM Sans, near-black neutral surfaces, small rounded controls, restrained borders, and a
single purple accent for project state. It avoids decoration and keeps attention on the conversation.
The control density resembles a professional developer tool rather than a consumer chat product.

That restraint is over-applied. Important interactive and informational text is often only a few
contrast steps above the background. The empty state, composer placeholder, control icons, inactive
thread metadata, and Settings link are hard to perceive without focused attention. Compact targets and
icon-only actions make the interface feel fast after learning it but slow to learn.

## 4. User-flow inventory

### 4.1 Launch, resume, and orientation — Observed

**Flow:** Open app -> restore projects and recent thread tree -> return to the last project-scoped draft
or conversation.

What works:

- Restoration is immediate and visually stable; no false onboarding or setup flash appeared.
- Project and thread context are visible before the user types.
- An unsent new thread occupies the main work surface without creating another visible history row.

UX risks:

- There is no strong indication of whether the empty surface is a local-only draft or a durable thread.
- `New thread` is implementation-oriented terminology compared with the more user-facing `New chat` or
  `New conversation`.
- The empty canvas offers no visible examples, command hint, privacy cue, or next-step explanation.

### 4.2 Add a project — Bundle-verified; not executed

**Entry points:** the plus beside `PROJECTS`; the add-project form; native folder browsing in Electron.

**Flow:** Add project -> `Browse for folder` or enter `/path/to/project` -> `Adding...` -> project appears
in the sidebar.

The installed UI supports a native picker plus a manual-path fallback and keeps an inline error near the
form. The model is compact and appropriate for a local-first developer tool.

UX assessment:

- Good: folder browsing is primary, while raw path entry remains available to expert users.
- Good: progress and validation errors remain within the project context.
- Weak: the tiny unlabeled plus is the only persistent entry point in the observed shell.
- Weak: the same visual symbol family is used for project creation, thread creation, and other add
  actions.
- Opportunity: after selection, continue directly into a focused project draft and explain non-Git
  limitations in place.

### 4.3 Start a new thread — Observed and bundle-verified

**Entry points:** per-project new-thread button; configured `Cmd+N`, `Cmd+Shift+O`, and forced-local
`Cmd+Shift+N` shortcuts.

**Flow:** choose project -> open `New thread` draft -> choose Local or New worktree -> optionally choose a
base branch -> configure agent controls -> type -> first send creates the thread.

This is T3 Code's strongest flow. It postpones durable creation until the user expresses intent and
keeps all important choices reversible around the composer.

UX assessment:

- Excellent: the draft is project-scoped and ready for intent immediately.
- Excellent: Local/New worktree is visible without dominating the composer.
- Good: New worktree requires a base branch before first send and reports `Preparing worktree`.
- Weak: the `Local` label does not explain whether it means current checkout, local execution, or no
  worktree.
- Weak: branch and environment controls sit below the composer and can look like passive metadata.
- Weak: multiple shortcut variants are powerful but undiscoverable unless labels/tooltips are visible.

### 4.4 Provider, model, and reasoning configuration — Observed and bundle-verified

The composer exposes provider/model and reasoning controls inline. The observed draft used GPT-5.4 with
High reasoning. The installed build supports Codex, Claude, OpenCode, and Gemini options, custom model
slugs, Codex reasoning effort, Claude effort including `ultrathink`, and `/model` suggestions.

UX assessment:

- Good: provider and model live beside the prompt they affect.
- Good: an existing thread can lock provider identity while still presenting model choices honestly.
- Good: custom model slugs appear in both the picker and slash-command system.
- Risk: model, provider, and effort are visually compressed into adjacent low-contrast chips; the user
  must already understand the vocabulary.
- Risk: `High` alone is ambiguous unless the menu or tooltip establishes that it means reasoning effort.
- Opportunity: surface provider health and unavailability at selection time, not only after failure.

### 4.5 Compose, attach, and send — Observed and bundle-verified; send not executed

**Flow:** enter text -> optionally attach/drop images -> preview/remove attachments -> send; while active,
the send action becomes `Stop generation`.

The composer supports up to the provider-defined image count, image-only prompts, a per-image size
limit, attachment previews, expanded image navigation, drag-and-drop, and explicit errors for unsupported
types and oversized files. Slash commands switch model and interaction mode.

UX assessment:

- Excellent: the composer is the dominant empty-state object.
- Good: attachments have preview, remove, persistence-warning, and gallery states.
- Good: send progress distinguishes `Preparing worktree`, `Sending`, and ready-to-send.
- Good: the same location becomes a stop action while generation runs.
- Weak: the placeholder (`Ask for follow-up changes or attach images`) is faint and is doing too much
  instructional work.
- Weak: attachment support is image-only, but this limitation is learned through an error rather than
  clear affordance copy.
- Risk: `Enter` to send and slash-command behavior require excellent focus handling, which could not be
  verified through the opaque accessibility surface.

### 4.6 Read a conversation and live work — Bundle-verified

**Flow:** user message -> assistant response streams -> work log/tool calls update -> changed files and
response are summarized -> copy or revert from message context.

The timeline distinguishes user, assistant, thinking, information, errors, proposed plans, tool calls,
changed files, terminal context, and a `Working...` state. Tool content can be expanded/collapsed as a
group. Messages expose copy actions and turn-level diff/revert affordances.

UX assessment:

- Strong: tool activity remains subordinate to the conversational outcome.
- Strong: `Work log`, `Tool calls`, and `Response` create understandable phases.
- Strong: collapse-all/expand-all controls manage long agent traces.
- Risk: many activity types rely on small icons and muted tones; they need non-color status text and
  meaningful announcements.
- Risk: a continuously growing timeline needs reliable scroll anchoring and focus preservation.

### 4.7 Interrupt a running turn — Bundle-verified; not executed

The composer replaces send with an explicitly named `Stop generation` action and dispatches a thread
interrupt. This is direct and appropriately close to the running work.

The UI should preserve the distinction among stopping, stopped, failed, and recovery-required work. The
installed copy establishes the stop action, but those complete state transitions were not exercised.

### 4.8 Permissions and approval — Bundle-verified; not executed

**Flow:** provider requests permission -> composer is blocked -> request panel names command, file read,
or file change -> user chooses decline/cancel, accept, or accept for session -> work continues.

What works:

- The request is placed beside the composer, where the next user action naturally belongs.
- Approval type is stated in words, not only by icon.
- `Accept for session` makes the scope of the broader permission visible.
- The composer explains that the request must be resolved to continue.

Risks:

- `Accept` versus `Accept for session` needs scope detail before activation.
- Command and file-change approvals should show the exact target, working directory, and consequence in
  a scan-friendly hierarchy.
- Stale and disconnected approval states need to be visibly non-actionable.

### 4.9 Structured user input — Bundle-verified

The installed build renders provider questions and selectable answers in a pending-input panel. Keyboard
handling and selected-state support are present in the UI source.

This is the right location and interaction model, but questions, optionality, multi-select rules, and
submission readiness must be obvious without relying on tiny secondary text.

### 4.10 Plan mode, refinement, and implementation — Bundle-verified; not executed

**Flow:** switch Chat -> Plan or use `/plan` -> provider proposes a plan -> inspect plan sidebar -> copy or
save -> add feedback and `Refine`, or `Implement` -> optionally implement in a new thread.

The composer clearly changes mode and provides a plan-specific follow-up banner. The side panel presents
step states and a full-plan view with save/copy actions.

UX assessment:

- Excellent: planning is a mode of the same conversation, not a disconnected wizard.
- Excellent: `Refine` and `Implement` make the decision at the end of planning explicit.
- Good: the plan can remain visible while continuing the conversation.
- Risk: `Plan` beside model/effort/permission controls creates a dense strip of similarly weighted
  concepts.
- Risk: implementing in a new thread must explain inherited context, branch/worktree choice, and the
  fate of the original plan.

### 4.11 Thread navigation and attention states — Observed and bundle-verified

Projects expand into thread lists. Threads can show running terminal state, PR state, pending approval,
pending input, and plan-ready attention. Context actions include Rename thread, Mark unread, Copy Path,
Copy Thread ID, and Delete.

UX assessment:

- Strong: attention states turn the sidebar into a lightweight work queue.
- Strong: thread metadata stays secondary to the title.
- Good: path and ID copying support technical support/debugging without cluttering the row.
- Weak: status icon density can become cryptic, especially when color and animation carry meaning.
- Weak: rename, unread, copy, and deletion are hidden in a context menu and need keyboard parity.

### 4.12 Delete a thread or project — Bundle-verified; not executed

Thread deletion warns that conversation history is permanently cleared. If a thread is the sole owner
of a worktree, a second decision asks whether to remove that worktree. Bulk deletion is supported.
Removing a non-empty project is blocked until its threads are deleted; project removal is distinct from
source deletion.

UX assessment:

- Strong: thread history, worktree cleanup, and project registration are treated as separate effects.
- Strong: failures after thread deletion but before worktree cleanup receive a precise warning.
- Concern: Settings includes a switch that can disable thread-deletion confirmation. Permanent local
  history deletion should retain a strong undo or recovery story if confirmation is disabled.

### 4.13 Branch and worktree selection — Observed and bundle-verified

**Flow:** choose Local/New worktree -> select or search a branch -> optionally create a branch from the
search query -> first send prepares the worktree. Existing thread/worktree state locks incompatible
choices.

The branch selector virtualizes large lists and exposes `Create new branch "..."`. PR references can
also be checked out into Local or Worktree mode.

UX assessment:

- Strong: branch creation is integrated at the point of need.
- Strong: the UI distinguishes current checkout from isolated worktree work.
- Good: impossible states are disabled rather than silently converted.
- Risk: destructive or stateful branch transitions need more context than the compact bottom-row chip
  can provide.

### 4.14 Open a pull-request thread — Bundle-verified; not executed

**Flow:** paste a GitHub PR URL, `123`, or `#123` -> resolve PR -> choose Local or Worktree -> prepare the
thread.

The dialog accepts several convenient reference formats, previews PR identity/state, and reports
resolution/preparation errors inline. This is an efficient expert flow. The main risk is ambiguity when a
bare number could refer to the wrong repository; the resolved owner/repository should be visually
confirmed before preparation.

### 4.15 Project actions/scripts — Observed and bundle-verified; command execution not executed

The header supports project-scoped actions. Users can add/edit an action with Name, icon, keybinding,
and Command, choose whether it runs as setup for a worktree, then run it from the header. Common icons
include Play, Test, Lint, Configure, Build, and Debug.

UX assessment:

- Powerful: repetitive project commands become named product actions.
- Good: actions can be visible and keyboard-addressable.
- Risk: `Add action` is prominent even on an empty new thread, ahead of more immediate conversation
  needs.
- Risk: the term `action` is generic; `Project command` or `Project task` would set expectations better.
- Safety: commands need an explicit project-root and shell-context preview when created or edited.

### 4.16 Terminal — Bundle-verified; shell execution not executed

**Flow:** toggle terminal -> open one or more terminals -> split/close -> type commands -> open detected
paths/links -> select output -> `Add to chat` -> terminal context appears in the composer.

The drawer supports multiple terminal groups, splits, resize, process state, link/path opening, clearing,
and attaching terminal output to the conversation. Expired terminal context is detected before send.

UX assessment:

- Excellent: `Add to chat` makes terminal context intentional rather than silently harvesting output.
- Strong: multi-terminal and split support are deep enough for real developer work.
- Strong: expired context produces a targeted recovery message.
- Risk: the drawer is dense and needs robust keyboard focus boundaries, accessible terminal naming, and
  predictable return focus.

### 4.17 Diff and changed-file review — Bundle-verified; restore not executed

**Flow:** open the diff panel -> browse changed files -> inspect additions/modifications/deletions ->
open files -> return to conversation. Turn messages also expose changed-file summaries and checkpoint
revert.

The header disables diff review for non-Git projects. Revert warns that newer messages and turn diffs
will be discarded and cannot be undone, and it blocks while a turn is active.

UX assessment:

- Strong: review is a contextual side surface rather than a navigation dead end.
- Strong: non-Git unavailability is explained.
- Strong: active work blocks checkpoint revert.
- Critical safety concern: an irreversible revert deserves an undo checkpoint or recovery mechanism,
  not only confirmation copy.

### 4.18 Commit, push, sync, and PR — Observed and bundle-verified; not executed

The header presents a state-derived quick action such as Commit, Commit & push, Commit, push & PR, Push,
Push & create PR, View PR, or Sync branch. A separate options menu exposes the broader action set.

The commit dialog asks the user to review and confirm a message and can auto-generate one. Progress is
staged (`Generating commit message`, `Committing`, `Pushing`, PR creation). The UI handles clean trees,
detached HEAD, missing origin, behind/diverged branches, missing commits, and existing PRs. Actions on a
default branch receive a dedicated confirmation and offer a feature-branch route.

UX assessment:

- Excellent: the main CTA adapts to repository state instead of presenting a static checklist.
- Excellent: default-branch risk receives context-specific confirmation.
- Strong: disabled reasons are specific and actionable.
- Risk: a one-click combined action has a large blast radius; its preflight should summarize files,
  branch, remote, generated text, and exact next steps before execution.
- Risk: `Commit, push & PR` is visually prominent even in a blank draft, competing with conversation
  creation.

### 4.19 Open/copy in external tools — Observed and bundle-verified; external launch not executed

The `Open` group can target Cursor, VS Code, Zed, Antigravity, Finder/Explorer/Files, and a configured
favorite editor. The adjacent menu provides copy options. File, path, and PR-link failures use targeted
toasts.

This is useful progressive disclosure, though the generic `Open` label hides the selected destination.
Showing `Open in VS Code` (or the selected favorite) would reduce uncertainty.

### 4.20 Settings — Entry observed; content bundle-verified

The native `Settings...` item and sidebar Settings entry exist. Selecting the native menu item during
the audit returned to the unchanged draft with no visible feedback, so the actual page could not be
reached through Computer Use.

The installed settings page contains:

- Appearance: System/Light/Dark and timestamp format.
- Codex App Server: binary path and `CODEX_HOME` override.
- Models: custom Codex and Claude model slugs.
- Git: model for commit messages, PR titles, and branch names.
- Threads: default Local versus New worktree mode.
- Responses: streaming on/off.
- Keybindings: reveal and open `keybindings.json`.
- Safety: confirm thread deletion.
- About: installed version.

UX assessment:

- Good: categories are plain-language and have short descriptions.
- Good: changed values get local `Restore default` actions.
- Good: advanced binary and model configuration is centralized.
- Weak: there is no settings search or section navigation despite a long single-column page.
- Weak: raw model slugs, binary paths, and JSON keybindings target experts without validation/test
  actions.
- Bug: the native Settings entry produced no visible navigation in the audited build.

### 4.21 About and update — Observed

The About dialog is a clean native panel with product icon, `0.0.13 (2a237c20019a)`, and copyright. It
is fully exposed to accessibility APIs, unlike the renderer.

`Check for Updates...` is available from both the application and Help menus. Triggering it produced no
visible progress, success, or failure feedback during the audit. The sidebar UI can represent download,
downloaded, install, and error states, but an explicit manual check should acknowledge that it started
and report the result.

### 4.22 Provider health, errors, and recovery — Bundle-verified

Provider health banners distinguish unavailable from limited availability and name Codex, Claude, or
the active provider. Thread errors are dismissible. Specific toasts cover link, editor, project,
worktree, Git, terminal, attachment, script, send, approval, and plan failures.

The breadth of targeted copy is good. Recovery UX should still keep failures near the object that needs
attention and explain whether retry is safe, whether the prompt was accepted, and whether provider
context can continue.

## 5. Accessibility and keyboard audit

### 5.1 Critical findings — Observed

1. The complete Electron renderer is exposed as two unnamed generic containers. No project, thread,
   button, composer field, select, menu, status, or transcript node is present in the macOS accessibility
   tree.
2. The native menu bar and About dialog are accessible, proving the failure is isolated to the renderer,
   not the operating environment.
3. Keyboard traversal through the generic renderer produced no visible focus indicator or activated
   state during the Computer Use pass.
4. Configured shortcuts for diff and terminal produced no visible change through the renderer focus
   surface. This may be a focus-bridge failure rather than a shortcut implementation failure, but the
   user outcome is still that automated/assistive navigation cannot reach the feature.
5. Much of the visible secondary text and placeholder copy appears below comfortable contrast levels.
6. Several icon targets appear close to 20 x 20 CSS pixels and below a robust 24 x 24 minimum target.

### 5.2 Required remediation

- Enable and validate Chromium/Electron accessibility semantics in the packaged build.
- Give every interactive control an accessible role, name, state, and deterministic keyboard action.
- Provide landmarks for project navigation, thread header, transcript, composer, terminal, plan, and
  diff surfaces.
- Restore focus predictably after dialogs, menus, panel toggles, thread switches, and draft promotion.
- Announce completed streamed messages and state changes without announcing every token.
- Ensure all icon actions have visible or programmatically associated labels and minimum targets.
- Test the complete critical journey with VoiceOver, keyboard only, 200% zoom, and reduced motion.

## 6. Responsive audit

### 6.1 Reproduced defect — Observed

After leaving maximized/full-screen presentation, the app rendered at approximately 1082 x 768. The
sidebar and empty transcript remained visible, but the right-side header controls disappeared and the
composer moved almost entirely below the bottom edge. Only a thin rounded edge remained visible. Window
Zoom/maximize restored the complete UI.

This blocks the primary action and should be treated as a critical layout defect. The shell needs a real
minimum height strategy, internal scrolling, and responsive control compaction that never removes the
composer or send readiness.

### 6.2 Narrow-surface priorities

When space is constrained, preserve in this order:

1. Composer text field and send/stop action.
2. Current project/thread identity.
3. Provider/model and permission summary.
4. Branch/worktree state.
5. A single overflow entry for project actions, editor, Git, terminal, diff, and secondary controls.

## 7. What MetaClanker should learn from T3 Code

Reuse these interaction lessons:

- Start from a project-scoped local draft and create durable work only on first send.
- Put provider, model, effort, permission, environment, and branch around the composer.
- Keep advanced tools progressively disclosed but reachable from the conversation.
- Make Git actions state-derived and explain why unavailable states are unavailable.
- Treat terminal output added to a prompt as explicit user-selected context.
- Make plan refinement and implementation a continuation of the conversation.
- Separate thread deletion, worktree cleanup, project removal, and source deletion.

Do not copy these weaknesses:

- An accessibility-opaque renderer.
- Ultra-low-contrast empty and secondary states.
- Tiny icon-only entry points for primary actions.
- Generic labels such as `Open`, `Add action`, `High`, and `Local` without contextual explanation.
- A header that prioritizes Git/project automation before the first prompt exists.
- Responsive behavior that can push the composer outside the viewport.
- Manual update and settings actions that can appear to do nothing.

## 8. Prioritized findings

### P0 — Blocks a critical journey

- The renderer has no usable macOS accessibility tree.
- The composer can fall below the viewport in a normal 1082 x 768 window.

### P1 — Major usability or trust issue

- Secondary text, placeholders, and icon states are too low contrast.
- Primary entry points rely on tiny, ambiguous icons.
- Native `Settings...` produced no visible navigation.
- Manual update checking gives no visible acknowledgement.
- Combined Git actions need a stronger preflight summary.

### P2 — Friction and clarity

- Explain `Local`, reasoning levels, and permission modes in context.
- Show the chosen external destination in the `Open` label.
- Rename generic project `actions` to tasks or commands.
- Add settings navigation/search and test actions for custom binaries/models.
- Make sidebar attention states understandable without color or hover.

## 9. Coverage ledger

| Flow                                | Evidence                   | Endpoint executed?           |
| ----------------------------------- | -------------------------- | ---------------------------- |
| Launch/resume                       | Observed                   | Yes                          |
| Project/thread shell                | Observed                   | Read-only                    |
| Empty new-thread draft              | Observed                   | Read-only                    |
| Provider/model/effort/mode controls | Observed + bundle-verified | No changes                   |
| Local/worktree/branch controls      | Observed + bundle-verified | No changes                   |
| Add project                         | Bundle-verified            | No                           |
| First prompt/send/stream/interrupt  | Bundle-verified            | No                           |
| Image attachments                   | Bundle-verified            | No                           |
| Permissions and user input          | Bundle-verified            | No                           |
| Plan/refine/implement               | Bundle-verified            | No                           |
| Thread context actions              | Bundle-verified            | No                           |
| Delete thread/project/worktree      | Bundle-verified            | No                           |
| PR thread                           | Bundle-verified            | No                           |
| Project scripts                     | Observed + bundle-verified | No commands run              |
| Terminal                            | Bundle-verified            | No shell run                 |
| Diff/checkpoint revert              | Bundle-verified            | No restore                   |
| Commit/push/PR                      | Observed + bundle-verified | No                           |
| External editor/file manager        | Observed + bundle-verified | No launch                    |
| Settings entry                      | Observed                   | Attempted; no navigation     |
| Settings content                    | Bundle-verified            | No changes                   |
| About                               | Observed                   | Yes, read-only               |
| Check for updates                   | Observed                   | Check triggered; no feedback |
| Window resizing                     | Observed                   | Yes                          |
| Keyboard/accessibility              | Observed                   | Read-only                    |

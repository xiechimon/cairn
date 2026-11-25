# Feature map

> Generated from `feature-map.json` in this directory by `scripts/generate-feature-map.mjs`. Edit the JSON, then run `node scripts/generate-feature-map.mjs`. The `gates` CI job runs it with `--check` and fails when this file drifts from the code.

Use it to turn a vague report or screenshot into exact steps: find the feature by what is on screen (test ids, labels, routes), follow its reach steps on the stack from `vp.mjs launch`, then drive the recipe under `features/` when one is listed. Reach steps use `open <route>`, `settings <section>`, `click testid:<id>`, `click label:<source label>`, `hover ...`, `press <keys>` and `type <text>`; every route, section, test id, label and key in them is checked against the source. A label is the zh source string passed to `t()`; the English UI shows the translation printed next to it. A `<...>` path segment is a parameter to bind on the launched stack, such as a thread id from `GET /api/todos`; route templates like `:id` are rejected.

Routes, settings paths, keyboard shortcuts and test ids below are extracted from `apps/web/src`, never typed by hand. `Mod` is Cmd on macOS and Ctrl elsewhere; a single letter is a menu key that works while its menu is open.

## Settings sections

| Section | Path in the settings window | Feature |
|---|---|---|
| `account` | `设置` (Settings) › `账号` (Account) | [Account and team](#account-and-team) |
| `routing` | `设置` (Settings) › `模型` (Model) › `模型` (Model) | [Model and work routing](#routing) |
| `machines` | `设置` (Settings) › `执行环境` (Execution) › `执行机` (Runners) | [Machines](#machines) |
| `skills` | `设置` (Settings) › `执行环境` (Execution) › `技能` (Skills) | [Skills](#skills) |
| `mcp` | `设置` (Settings) › `执行环境` (Execution) › `应用` (Apps) | [MCP servers](#mcp-servers) |
| `secrets` | `设置` (Settings) › `安全` (Security) › `密钥与环境变量` (Secrets & env vars) | [Secrets](#secrets) |
| `vault` | `设置` (Settings) › `安全` (Security) › `保险库` (Vault) | [Secrets](#secrets) |
| `api-keys` | `设置` (Settings) › `安全` (Security) › `API 密钥` (API keys) | [API keys](#api-keys) |
| `remote` | `设置` (Settings) › `安全` (Security) › `远程访问` (Remote access) | [Remote access over the tailnet](#remote-access) |
| `im` | `设置` (Settings) › `消息` (Messages) › `聊天应用` (Chat apps) | [IM connections](#im-connections) |

## Features

### agent-computer

**The agent's computer** (partial, centrality 1). The Coordinator's own persistent computer and guarded access to the user's machine. An idle machine is one quiet row; while an agent acts on it the row shows what it does and the latest step screenshot; the full screen opens on demand with explicit Take over and Give back. Browser and desktop control are always on wherever the machine reports the capability; there is no setting.

States: No computer; one machine card per computer with an activity line (in use by a task or the Coordinator, idle with the last user, none) and no line when offline; idle quiet row with no screen box; agent acting: the latest step screenshot with a click dot and no status text, a quiet row for a browser step with no screenshot, a no-picture line with the Screen Recording or unlocked fix; full screen opened from the step screenshot or the menu, watching, taken over, given back; takeover card in the Coordinator conversation waiting, owner in control, refused, handed back, not finished; package install approval card waiting, approved, declined, installed, not answered, failed, owner-only refusal; VM computer actions menu (stop, update, recover, reset with confirmation) with done and failed notes; own-Mac switch on the machine row in Settings, Computers: off with the warning on the switch hover; state folds into the row's meta line — finish setup in the Cairn app, installing, verifying read as plain meta text; install failed, not installed, Accessibility missing and Screen Recording missing expand an inline drawer (open by default) with the reason and their actions; ready adds nothing to the row (no action log in the product); own-Mac approval card in the Coordinator conversation (allow once, allow in this conversation or always allow this command, deny); browser unsupported (no capabilities.browser) and offline machine. Cloak browser prepared, missing credentials, failed acquisition, invalid profile identity, and shared-profile agent/owner/Dock handoff with no debugging port during owner control.

Reach:

1. `open /app`
2. `click testid:machines-button`
3. `click testid:machine-step-watch`

- Web routes: none
- Keyboard shortcuts in its code: `E`, `N`, `V`
- Test ids in its code: `chief-takeover`, `chief-takeover-failed`, `chief-takeover-handback`, `chief-takeover-open`, `chief-takeover-push-on`, `chief-takeover-time-left`, `disconnected`, `machine-activity`, `machine-card`, `machine-line`, `machine-list-row`, `machine-menu`, `machine-rename`, `machine-rename-input`, `machine-screen`, `machine-screen-bar`, `machine-screen-control`, `machine-screen-disconnected`, `machine-screen-enlarged`, `machine-screen-exit`, `machine-screen-last-frame`, `machine-screen-note`, `machine-screen-reconnect`, `machine-screen-status`, `machine-settings`, `machine-status-dot`, `machine-step`, `machine-step-click`, `machine-step-no-shot`, `machine-step-shot`, `machine-step-watch`, `machine-take-over`, `machine-watch`, `machines-add`, `machines-button`, `own-computer-browser-hint`, `own-computer-drawer`, `own-computer-guide`, `own-computer-meta`, `own-computer-recheck`, `own-computer-status`
- Research: [docs/research/coordinator-computer.md](../../../docs/research/coordinator-computer.md) (not on main), [docs/research/agent-small-computer-2026-11-08.md](../../../docs/research/agent-small-computer-2026-11-08.md) (not on main), [docs/research/user-computer-model-2026-11-08.md](../../../docs/research/user-computer-model-2026-11-08.md) (not on main), [docs/research/resident-cloakbrowser-2026-11-16.md](../../../docs/research/resident-cloakbrowser-2026-11-16.md)
- Frontend design: **gap**: the screen view and control handover have no design
- Backend design: [docs/design/computer-login-handoff.md](../../../docs/design/computer-login-handoff.md), [docs/design/cloakbrowser-computer.md](../../../docs/design/cloakbrowser-computer.md), [docs/design/own-mac-computer.md](../../../docs/design/own-mac-computer.md)
- Evidence: `apps/web/e2e/machines-computer-card.spec.ts`, `apps/web/e2e/machines-own-computer.spec.ts`, `apps/server/test/computer-control-open-migration.test.ts`, `apps/server/test/own-computer.test.ts`, `apps/server/test/chief-claim-computer-tools.test.ts`, `apps/server/test/machine-computer-forward.test.ts`, `apps/daemon/test/computer-orb-dispatch.test.ts`, `apps/daemon/test/own-computer-daemon.test.ts`, `apps/web/test/machine-capabilities.test.ts`, `apps/server/test/computer-screen-routes.test.ts`, `apps/server/test/computer-routes.test.ts`, `apps/daemon/test/computer-browser.test.ts`, `apps/daemon/test/machine-boot.test.ts`, `apps/daemon/test/computer-host-desktop.test.ts`, `apps/daemon/test/computer-cloak-browser.test.ts`

### coordinator-chat

**Coordinator chat** (shipped, centrality 1). The one never-ending Coordinator conversation on the home page, where the user dispatches work and reads reports.

States: Empty home with starters, streaming reply with a stop control, finished reply with an action row and, when the Coordinator offered them, quick-reply chips above the composer, and a connection-lost banner when the stream drops. A failed initial project greeting offers explicit retry with a reason, without inventing an owner message; pending, running, stale and ineligible retries are refused.

Reach:

1. `open /app`
2. `click testid:chief-composer-block`
3. `type a request and press Enter`

- Web routes: `/app`
- Keyboard shortcuts in its code: `A`, `R`, `W`
- Test ids in its code: `*`, `approval-card-context`, `approval-card-note`, `approval-card-problem`, `approval-card-quote`, `approval-card-title`, `approval-detail-label`, `approval-details`, `approval-details-toggle`, `approval-field-more`, `approval-field-value`, `approval-history-text`, `approval-history-toggle`, `channel-usage`, `channel-usage-stats`, `chief-body`, `chief-bubble`, `chief-channel-mirror`, `chief-chat-block`, `chief-composer-block`, `chief-composer-input`, `chief-composer-placeholder`, `chief-earlier`, `chief-fallback-banner`, `chief-fallback-note`, `chief-gate`, `chief-handoff`, `chief-home-scroll`, `chief-msg`, `chief-msg-block-tools`, `chief-msg-col`, `chief-msg-copy`, `chief-msg-foot`, `chief-msg-more`, `chief-msg-sending`, `chief-msg-stamp`, `chief-msg-tools`, `chief-msg-tools-touch`, `chief-note`, `chief-outage`, `chief-question`, `chief-question-count`, `chief-question-dock`, `chief-question-error`, `chief-question-minimize`, `chief-question-next`, `chief-question-option-*`, `chief-question-option-description`, `chief-question-other-*`, `chief-question-pager`, `chief-question-prev`, `chief-question-receipt`, `chief-question-receipt-answer`, `chief-question-receipt-question`, `chief-question-recommended`, `chief-question-restore`, `chief-question-skip`, `chief-question-text`, `chief-queue`, `chief-queue-more`, `chief-queue-switch-machine`, `chief-queue-wait-card`, `chief-queued-message`, `chief-queued-message-text`, `chief-queued-remove`, `chief-quick-replies`, `chief-quick-reply`, `chief-reply`, `chief-reply-bubble`, `chief-report`, `chief-report-sentence`, `chief-runner-offline`, `chief-secret-request`, `chief-secret-request-input`, `chief-sent-attachment`, `chief-sent-attachments`, `chief-status-live`, `chief-status-mark`, `chief-status-pill`, `chief-steer-withdraw`, `chief-stopped`, `chief-stream`, `chief-takeover`, `chief-takeover-failed`, `chief-takeover-handback`, `chief-takeover-open`, `chief-takeover-push-on`, `chief-takeover-time-left`, `chief-task-started`, `chief-task-started-said`, `chief-time-divider`, `chief-turn-error`, `chief-turn-error-card`, `chief-turn-error-raw`, `chief-turn-retry`, `chief-turn-update`, `chief-virtual-rows`, `composer-context-meter`, `composer-plus`, `composer-reply-bar`, `composer-reply-quote`, `composer-reply-quote-remove`, `connection-lost`, `context-panel`, `context-panel-*`, `context-panel-reading`, `copy-markdown`, `home-c`, `home-c-error`, `home-c-pane-buttons`, `memory-edit-card`, `memory-edit-composer`, `memory-edit-content`, `memory-edit-input`, `memory-edit-send`, `memory-edit-stop`, `memory-edit-title`, `memory-list`, `memory-usage`, `panel-error`, `project-instructions-input`, `queue-blocked-fix`, `reply-quote`, `research-report-card`, `research-report-doc`, `research-report-hover`, `research-report-meta`, `selection-quote`, `selection-quote-add`, `selection-quote-box`, `selection-quote-hint`, `selection-quote-input`, `selection-quote-send`, `selection-quote-text`, `selection-reply-bar`, `tasks-badge`, `tasks-toggle`, `update`
- Verify recipes: [.claude/skills/verify-cairn/features/chief-segments.md](features/chief-segments.md), [.claude/skills/verify-cairn/features/failed-send.md](features/failed-send.md)
- Research: [docs/research/coordinator-in-server.md](../../../docs/research/coordinator-in-server.md), [docs/research/dsh-sig-walk-2026-11.md](../../../docs/research/dsh-sig-walk-2026-11.md), [docs/research/pi-durable-spike.md](../../../docs/research/pi-durable-spike.md) (not on main), [docs/research/chat-markdown-polish-2026-11-08.md](../../../docs/research/chat-markdown-polish-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat), [docs/design/pilot-coordinator-chat-2026-11-06.md](../../../docs/design/pilot-coordinator-chat-2026-11-06.md) (not on main)
- Backend design: [docs/research/coordinator-in-server.md](../../../docs/research/coordinator-in-server.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](../../../docs/spec/26-pi-session-runtime-and-trust-surface.md), [docs/design/coordinator-project-channels.md](../../../docs/design/coordinator-project-channels.md), [docs/design/coordinator-quick-replies.md](../../../docs/design/coordinator-quick-replies.md)
- Evidence: `apps/web/e2e/chief-home-chat.spec.ts`, `apps/web/e2e/chief-home-c.spec.ts`, `apps/web/e2e/chief-greeting-retry.spec.ts`, `apps/server/test/coordinator-project-channels.test.ts`, `apps/server/test/coordinator-turns.test.ts`, `apps/server/test/coordinator/turn.test.ts`

### coordinator-context

**Coordinator context and compaction** (shipped, centrality 1). Each Coordinator turn is assembled by the server within a token budget from recent messages, an index of older ones, history tools and ledger facts, so compaction is invisible to the user.

States: Invisible to the user; older history loads above the conversation from the earlier button.

Reach:

1. `open /app`
2. `click testid:chief-earlier`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/coordinator-compaction-2026-11-07.md](../../../docs/research/coordinator-compaction-2026-11-07.md), [docs/research/personal-agent-memory-2026-11-07.md](../../../docs/research/personal-agent-memory-2026-11-07.md), [docs/research/coordinator-context-2026-11-08.md](../../../docs/research/coordinator-context-2026-11-08.md)
- Frontend design: n/a: compaction is invisible by design; the transcript keeps full history
- Backend design: [docs/design/coordinator-context-backend.md](../../../docs/design/coordinator-context-backend.md)
- Evidence: `apps/server/test/chief-history.test.ts`, `apps/server/test/coordinator/compaction.test.ts`

### coordinator-dispatch

**Coordinator dispatch** (shipped, centrality 1). The Coordinator opens threads, picks the project, machine and model for each, and orchestrates splits; fixed role agents are retired.

States: The reply shows a handoff card and a thread activity row per dispatched thread, which updates as the thread runs and reports.

Reach:

1. `open /app`
2. `type a task for the Coordinator and press Enter`
3. `click testid:task-mention`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/chief-dispatch-judgment.md](features/chief-dispatch-judgment.md)
- Research: [docs/research/cairn-dogfood-feasibility-2026-11-06.md](../../../docs/research/cairn-dogfood-feasibility-2026-11-06.md), [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md), [docs/research/r14-orchestration-parent-card.md](../../../docs/research/r14-orchestration-parent-card.md), [docs/research/r15-agent-responsibility-default.md](../../../docs/research/r15-agent-responsibility-default.md)
- Frontend design: n/a: dispatch shows as one sub-thread row under the reply that started it inside the Coordinator chat
- Backend design: [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md), [docs/research/r14-orchestration-parent-card.md](../../../docs/research/r14-orchestration-parent-card.md)
- Evidence: `apps/server/test/chief-dispatch.test.ts`, `apps/server/test/agent-removal.test.ts`

### daily-report

**Read-only report history** (shipped, centrality 1). Existing report messages remain readable; daily generation, retries, push and suggestion decisions are retired.

States: Historical posted and unfinished reports, read-only draft suggestions and links to already-created tasks. No new report for new users. Historical intake suggestions remain hidden; the chief_report/retro_proposal tables are dropped.

Reach:

1. `open /app`
2. `click testid:research-report-card`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-report-sentence`, `copy-markdown`, `research-report-card`, `research-report-doc`, `research-report-hover`, `research-report-meta`
- Research: [docs/research/duet-proactive-coordinator.md](../../../docs/research/duet-proactive-coordinator.md)
- Frontend design: [apps/web/DESIGN.md](../../../apps/web/DESIGN.md)
- Backend design: **gap**: Retired: only chief_message report rows remain for read-only rendering; report-linked steps are stopped and the bookkeeping tables are dropped.
- Evidence: `apps/web/e2e/chief-daily-report.spec.ts`, `apps/server/test/daily-report-retirement.test.ts`

### engine-view

**Engine run in a task thread** (partial, centrality 1). A run that a task thread dispatched to an engine (Claude Code, Codex) is the thread's own conversation, with time and cost in the usage popover and a raw output view in the thread menu, synthesized from the transcript.

States: Running with the plan checklist, trace rows and the typing bubble; waiting on a question with allow once and refuse; finished with time and cost; failed with the failed command open; an unknown event as a row that opens its raw payload; a long step list that folds its earlier steps; no tail when the thread carries no run.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click label:更多操作…`
3. `click label:原始输出`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `engine-question`, `engine-raw`, `engine-raw-copy`, `engine-raw-view`
- Research: [docs/design/durable-threads-and-engines.md](../../../docs/design/durable-threads-and-engines.md)
- Frontend design: [docs/design/durable-threads-and-engines.md](../../../docs/design/durable-threads-and-engines.md), [docs/design/references/thread-review](../../../docs/design/references/thread-review)
- Backend design: [docs/design/durable-threads-and-engines.md](../../../docs/design/durable-threads-and-engines.md), [docs/design/side-panels-backend-gaps.md](../../../docs/design/side-panels-backend-gaps.md)
- Evidence: `apps/web/e2e/chief-home-engine-run.spec.ts`, `apps/web/test/engine-run.test.ts`

### harness-dispatch

**Harness dispatch** (shipped, centrality 1). Each thread runs on a subscription CLI (Claude Code, Codex, pi) driven by the daemon, mostly through ACP, with the mode fixed at thread start.

States: No user page of its own; the thread transcript shows which harness and model ran each turn.

Reach:

1. `settings routing`
2. `click testid:routing-section`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/local-daemon-executor.md](features/local-daemon-executor.md)
- Research: [docs/research/1607-acp-execution-surface.md](../../../docs/research/1607-acp-execution-surface.md), [docs/research/r4-foundation.md](../../../docs/research/r4-foundation.md), [docs/research/r10-multica-runtime.md](../../../docs/research/r10-multica-runtime.md), [docs/research/r11-runtime-gap.md](../../../docs/research/r11-runtime-gap.md), [docs/research/herdr-multica-parity.md](../../../docs/research/herdr-multica-parity.md)
- Frontend design: n/a: harness choice surfaces through routing settings and the thread's model line
- Backend design: [docs/spec/17-dual-runtime-execution-surface.md](../../../docs/spec/17-dual-runtime-execution-surface.md), [docs/design/runtime-memory-out-of-tree.md](../../../docs/design/runtime-memory-out-of-tree.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](../../../docs/spec/26-pi-session-runtime-and-trust-surface.md)
- Evidence: `apps/daemon/test/acp.test.ts`, `apps/daemon/test/runner-runtime.test.ts`, `integration/test/pi-session-policy.test.ts`

### memory

**Memory** (shipped, centrality 1). Team and project memories the Coordinator reads, writes and injects into later turns and threads. Oversized indexes prompt normal-turn maintenance; no daily tidy pass runs. Owners edit memory conversationally through a durable memory-edit request run on a dedicated chief-memory side thread restricted to the four memory tools, with receipts and before/after diffs. A first-run import card offers CLAUDE.md/AGENTS.md files as unverified searchable memory.

States: Shipped: the sidebar Memory dialog lists team memory; each project settings page has a Memory tab with the project instructions and that project's memory. Core rows are read by every thread, searchable rows are memory files; a row opens a detail dialog with Delete. Composer states: input, working, applied, awaiting input (CLARIFY), partial, stopped, error and offline; page and focused-file composers; receipt diff cards; import candidates card with per-file Import and dismiss.

Reach:

1. `open /app`
2. `click label:记忆`
3. `open /app/project/<id of a project listed by the projects API>/settings`
4. `click label:记忆`

- Web routes: `/app/project/:id/settings`
- Keyboard shortcuts in its code: none
- Test ids in its code: `memory-edit-card`, `memory-edit-composer`, `memory-edit-content`, `memory-edit-input`, `memory-edit-send`, `memory-edit-stop`, `memory-edit-title`, `memory-list`, `memory-usage`, `project-instructions-input`
- Research: [docs/research/personal-agent-memory-2026-11-07.md](../../../docs/research/personal-agent-memory-2026-11-07.md), [docs/research/research-loop-plan.md](../../../docs/research/research-loop-plan.md), [docs/research/memory-2026-11-08.md](../../../docs/research/memory-2026-11-08.md), [docs/research/memory-inplace-edit-2026-11-09.md](../../../docs/research/memory-inplace-edit-2026-11-09.md)
- Frontend design: [docs/design/memory-inplace-edit.md](../../../docs/design/memory-inplace-edit.md) (not on main)
- Backend design: [docs/design/memory-backend.md](../../../docs/design/memory-backend.md), [docs/design/memory-inplace-edit.md](../../../docs/design/memory-inplace-edit.md) (not on main)
- Evidence: `apps/web/e2e/chief-memory.spec.ts`, `apps/web/test/memory-list.test.ts`, `apps/server/test/memory-callers-documents.test.ts`, `apps/server/test/memory-edit.test.ts`, `apps/server/test/memory-import.test.ts`, `apps/server/test/project-memory.test.ts`, `integration/test/m4b-memory-e2e.test.ts`

### merge-gate

**Completed delivery and explicit merge** (shipped, centrality 1). Successful code tasks finish with their branch or PR retained. Only an explicit conversational user request initiates a merge, without a mandatory agent review or merge-choice UI.

States: Delivered code is completed without a merge dialog. Explicit merge requests can succeed or be refused for permissions, a changed delivery or target, duplicate operations, or a dirty workspace.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:thread-pr-panel`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `side-chat-action`
- Research: [docs/research/remove-product-merge-gate-2026-11-16.md](../../../docs/research/remove-product-merge-gate-2026-11-16.md)
- Frontend design: [docs/design/remove-product-merge-gate.md](../../../docs/design/remove-product-merge-gate.md)
- Backend design: [docs/design/remove-product-merge-gate.md](../../../docs/design/remove-product-merge-gate.md)
- Evidence: `apps/server/test/pr-merge-api.test.ts`, `apps/server/test/local-merge-landing.test.ts`, `apps/web/e2e/info-card-report.spec.ts`, `integration/test/g2t2-local-lifecycle.test.ts`

### needs-you

**Task references and needs-you** (shipped, centrality 1). A task the Coordinator creates or mentions shows as one reference row above the reply, tinted by its status, and opens the task panel; the Tasks toggle carries the needs-you count.

States: One reference row per task per reply (working, waiting, resolved, failed tint; unread dot); a lone row without a connector when the turn has no reply yet; a one-line link when the page no longer knows the task; no tray above the composer.

Reach:

1. `open /app`
2. `click testid:task-mention`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/link-roundup-2026-11-01.md](../../../docs/research/link-roundup-2026-11-01.md), [docs/research/ui-ux-audit-2026-11-06.md](../../../docs/research/ui-ux-audit-2026-11-06.md) (not on main), [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md)
- Frontend design: [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md)
- Backend design: **gap**: no design for which records enter the tray, their order and when they leave
- Evidence: `apps/web/e2e/chief-home-needs-you.spec.ts`, `apps/web/e2e/chief-home-tray.spec.ts`, `apps/server/test/needs-you.test.ts`

### plans-and-review

**Plans, approval and review** (shipped, centrality 1). A thread's plan document with approval, timed auto-approve that can be paused, document diffs, and review that can reject work.

States: A plan waiting for approval with an auto-approve countdown that can be paused, approved, rejected with a request for changes, or compared against an earlier version.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click label:查看计划`
3. `click testid:doc-pane`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `diff-fold`, `diff-full`, `doc-body`, `doc-pane`
- Verify recipes: [.claude/skills/verify-cairn/features/review-modal.md](features/review-modal.md), [.claude/skills/verify-cairn/features/review-reject.md](features/review-reject.md)
- Research: [docs/research/m7-w5-ai-review-slice.md](../../../docs/research/m7-w5-ai-review-slice.md), [docs/research/892-gate-usage-measurement.md](../../../docs/research/892-gate-usage-measurement.md)
- Frontend design: **gap**: the plan pane, auto-approve countdown and reject flow have no current design
- Backend design: [docs/spec/08-m7-feature-closed-loop.md](../../../docs/spec/08-m7-feature-closed-loop.md)
- Evidence: `apps/web/e2e/spec-flow.spec.ts`, `apps/server/test/plan-server-auto-confirm.test.ts`, `apps/server/test/review-reject.test.ts`

### push-notifications

**Phone push** (shipped, centrality 1). Web Push and APNs to the user's devices when something needs them, suppressed while they are looking at the thread.

States: Off, asking for permission, or on for this device; a notification opens the thread it names.

Reach:

1. `open /app`
2. `click testid:tasks-toggle`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/ios-apns-push-2026-11-14.md](../../../docs/research/ios-apns-push-2026-11-14.md)
- Frontend design: **gap**: the notify banner, device switch and push copy have no design
- Backend design: **gap**: no design for subscriptions, presence suppression, receipts and the three push states
- Evidence: `apps/web/e2e/push-device-switch.spec.ts`, `apps/web/e2e/notify-click.spec.ts`, `apps/server/test/push.test.ts`, `apps/server/test/apns.test.ts`

### questions

**Question cards** (shipped, centrality 1). Questions from the Coordinator or a thread appear as answerable cards above the composer, stay parked quietly, and keep per-question drafts.

States: A question card sits above the composer with numbered options and a recommended one; it can be collapsed, answered later, or cancelled, and shows a line once answered.

Reach:

1. `open /app`
2. `click testid:chief-question-option-0-0`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-question`, `chief-question-count`, `chief-question-dock`, `chief-question-error`, `chief-question-minimize`, `chief-question-next`, `chief-question-option-*`, `chief-question-option-description`, `chief-question-other-*`, `chief-question-pager`, `chief-question-prev`, `chief-question-recommended`, `chief-question-restore`, `chief-question-skip`, `chief-question-text`
- Research: **gap**: the Codex CLI and t3code question patterns were never written up
- Frontend design: [docs/design/qcard-variants/README.md](../../../docs/design/qcard-variants/README.md) (not on main), [docs/design/pilot-coordinator-chat-2026-11-06.md](../../../docs/design/pilot-coordinator-chat-2026-11-06.md) (not on main)
- Backend design: **gap**: no design for the question lifecycle: parking, late answers, cancel and resume
- Evidence: `apps/web/e2e/chief-home-questions.spec.ts`, `apps/server/test/chief-questions.test.ts`, `apps/web/test/question-lifecycle.test.ts`

### routing

**Model and work routing** (shipped, centrality 1). Which model each kind of work uses: the Model selector page (the Coordinator with model and thinking level, which tasks follow by default, and the frequently used models the Coordinator picks from per task), the Model routing page (providers with quota, Claude billing, and a graph wiring each rule to its provider), capabilities and a per-thread override.

States: A graph from each use to its provider with dashed wires for unavailable providers, an empty state, one picker row per use with runtimes no Runner enabled greyed out, and a per-thread override dialog.

Reach:

1. `settings routing`
2. `click testid:routing-section`

- Web routes: `/app/resources/model-routing`, `/app/resources/routing-settings`, `/app/settings/team`, `/app/team`
- Settings: `设置` (Settings) › `模型` (Model) › `模型` (Model)
- Keyboard shortcuts in its code: none
- Test ids in its code: `frequent-model-row`, `frequent-models`, `frequent-models-empty`, `route-override-dialog`, `route-override-machine`, `route-override-mcp-*`, `route-override-platform`, `route-override-save`, `routing-add-provider`, `routing-coordinator-default`, `routing-project-overrides`, `routing-rule-*`, `routing-rule-new-*`, `routing-section`
- Research: [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md), [docs/research/agent-machine-routing.md](../../../docs/research/agent-machine-routing.md) (not on main)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md)
- Evidence: `apps/web/e2e/settings-routing.spec.ts`, `apps/web/e2e/route-override-capabilities.spec.ts`, `apps/server/test/routing-rules.test.ts`

### selection-reply

**Reply quote** (shipped, centrality 1). Press Reply in your own message's hover tools to quote it above the composer. Coordinator messages have no reply arrow (owner decision, 2026-11-21); instead, select text in a Coordinator message to get a pill with Quote (R); it opens a one-input box where Enter stages the quote above the composer and Cmd+Enter sends it at once; The sent message carries the quote and its source message id.

States: Selection pill, quote box with its key hint, quote staged above the composer from your own message or a selection, source marked while the quote bar is hovered and unmarked once it is removed, sent bubble with the quote, light and dark, 1440 and 390 wide.

Reach:

1. `open /app`
2. `hover testid:chief-reply`
3. `click testid:selection-quote`

- Web routes: `/app`
- Keyboard shortcuts in its code: `R`
- Test ids in its code: `composer-reply-bar`, `composer-reply-quote`, `composer-reply-quote-remove`, `reply-quote`, `selection-quote`, `selection-quote-add`, `selection-quote-box`, `selection-quote-hint`, `selection-quote-input`, `selection-quote-send`, `selection-quote-text`, `selection-reply-bar`
- Research: [docs/research/selection-reply-2026-11-08.md](../../../docs/research/selection-reply-2026-11-08.md)
- Frontend design: [docs/design/selection-reply-2026-11-08.md](../../../docs/design/selection-reply-2026-11-08.md)
- Backend design: [docs/design/selection-reply-2026-11-08.md](../../../docs/design/selection-reply-2026-11-08.md)
- Evidence: `apps/web/e2e/chief-reply-quote.spec.ts`, `apps/web/e2e/chief-selection-quote.spec.ts`, `packages/shared/test/reply-quote.test.ts`

### steer-queue-stop

**Steer, queue and stop** (shipped, centrality 1). The user can steer a running thread, queue messages behind it, stop it, or stop and mark it done.

States: While a thread runs, new messages queue as capsules or steer the current turn; stop asks for confirmation and the thread shows a stopped row.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:composer-card`
3. `type a follow-up while the thread runs`
4. `click label:停止`

- Web routes: none
- Keyboard shortcuts in its code: `A`
- Test ids in its code: `composer-card`, `composer-placeholder`, `composer-plus`, `composer-toolbar`
- Verify recipes: [.claude/skills/verify-cairn/features/stop-button.md](features/stop-button.md)
- Research: **gap**: no note on how Amp, Claude Code and Codex steer, queue and interrupt
- Frontend design: **gap**: the queued-message list, steer affordance and stop confirmation have no design
- Backend design: **gap**: no design for queue ordering, steer delivery to each harness and stop semantics
- Evidence: `apps/web/e2e/detail-composer-queue-stop.spec.ts`, `apps/server/test/composer-queue-stop.test.ts`, `apps/server/test/steer.test.ts`, `apps/server/test/stop.test.ts`

### step-claim

**Machine work protocol** (shipped, centrality 1). Daemons claim steps, heartbeat, receive steer and stop, upload results and recover, so the same work runs on any registered machine.

States: No user page; machines show what they are running and threads move from queued to running when a step is claimed.

Reach:

1. `settings machines`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/machine-execution-plane.md](../../../docs/research/machine-execution-plane.md), [docs/research/r13-multica-runtime-verify.md](../../../docs/research/r13-multica-runtime-verify.md)
- Frontend design: n/a: a protocol between server and daemon with no user surface
- Backend design: [docs/research/2513-tla-statecharts.md](../../../docs/research/2513-tla-statecharts.md)
- Evidence: `apps/server/test/machine-pool-claim.test.ts`, `apps/server/test/machine-zombie-claim.test.ts`, `apps/daemon/test/machine-claim.test.ts`

### thread-pr-panel

**Thread PR panel and auto-fix** (shipped, centrality 1). The thread that opens a PR owns it until merge: the PR panel with changes and checks, and wakes on CI, conflicts and review comments.

States: No PR yet, open with checks running or failing, conflicts, merged, or a load error; changes open file by file.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:thread-pr-panel`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `thread-pr-error`, `thread-pr-panel`
- Research: [docs/research/thread-pr-placement-2026-11-06.md](../../../docs/research/thread-pr-placement-2026-11-06.md) (not on main), [docs/research/review-findings-before-ready-2026-11-07.md](../../../docs/research/review-findings-before-ready-2026-11-07.md)
- Frontend design: [docs/design/references/thread-review](../../../docs/design/references/thread-review)
- Backend design: [docs/research/thread-pr-autofix.md](../../../docs/research/thread-pr-autofix.md)
- Evidence: `apps/web/e2e/thread-pr-panel.spec.ts`, `apps/web/test/pr-panel-model.test.ts`, `apps/server/test/thread-pr.test.ts`

### thread-transcript

**Thread transcript and work trace** (shipped, centrality 1). The live transcript of a thread's run: messages, tool rows, thinking, steps and usage in the side panel.

States: Messages stream in with tool and thinking rows; finished, cancelled and unfinished work blocks; usage shows in the footer.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:side-chat`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `agent-text`, `agent-todo`, `automation-completed`, `edit-error`, `engine-run`, `home-c`, `info-report`, `left`, `live-row`, `made-archived-empty`, `made-archived-note`, `made-empty`, `made-group`, `made-group-count`, `made-no-match`, `made-search-toggle`, `made-tabs`, `msg-stamp`, `msg-tools`, `msg-tools-touch`, `queued-capsules-standalone`, `right`, `schedule-wake-marker`, `scheduled-turn`, `side-chat`, `side-chat-back`, `side-chat-changes`, `side-chat-changes-body`, `side-chat-changes-toggle`, `side-chat-collapse`, `side-chat-file`, `side-chat-full-file`, `side-chat-panel`, `side-chat-plan`, `side-chat-send-error`, `side-chat-status`, `side-chat-unavailable`, `skills-summary`, `step-prompt-raw`, `thinking-body`, `tool-output`, `transcript-fail`, `transcript-note`, `transcript-question`, `transcript-quota-wait`, `transcript-step-prompt`, `transcript-time-divider`, `user-bubble`, `verify-evidence`, `work-block`, `work-call`, `work-cancelled`, `work-earlier`, `work-say-line`, `work-spinner`, `work-summary`, `work-think`, `work-unfinished`
- Verify recipes: [.claude/skills/verify-cairn/features/detail-right-pane.md](features/detail-right-pane.md)
- Research: [docs/research/r15-multica-run-rendering.md](../../../docs/research/r15-multica-run-rendering.md), [docs/research/chat-markdown-polish-2026-11-08.md](../../../docs/research/chat-markdown-polish-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/thread-review](../../../docs/design/references/thread-review)
- Backend design: [docs/spec/17-dual-runtime-execution-surface.md](../../../docs/spec/17-dual-runtime-execution-surface.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](../../../docs/spec/26-pi-session-runtime-and-trust-surface.md)
- Evidence: `apps/web/e2e/detail-work-trace.spec.ts`, `apps/web/e2e/chief-home-side-chat.spec.ts`, `apps/web/test/work-trace-mapper.test.ts`, `apps/server/test/conv-stream-catchup.test.ts`

### threads

**Threads** (shipped, centrality 1). A thread is one piece of work with its own session: created, continued, archived and counted by phase.

States: Running, waiting on the user, done or archived; the thread opens in the side panel with its actions menu. Tasks reads include recent archives and pending standalone Coordinator questions; section is derived on every read.

Reach:

1. `open /app`
2. `click testid:tasks-toggle`
3. `click testid:tasks-section`
4. `click testid:side-chat-action`

- Web routes: `/app/todo/:id`
- Keyboard shortcuts in its code: `A`
- Test ids in its code: `agent-text`, `agent-todo`, `artifact-diagram`, `artifact-diagram-notice`, `automation-completed`, `bg-task`, `bg-task-detail`, `bg-task-running-dot`, `bg-task-stop`, `bg-tasks`, `chat-artifact-card`, `chat-artifact-image`, `chat-artifact-meta`, `chat-artifact-video`, `chat-artifact-video-open`, `chief-reply-bubble`, `composer-card`, `composer-placeholder`, `composer-plus`, `composer-toolbar`, `diff-fold`, `diff-full`, `doc-body`, `doc-pane`, `edit-error`, `info-report`, `left`, `live-row`, `md-checkbox`, `md-code`, `md-code-block`, `md-code-copy`, `md-code-dialog-body`, `md-code-dialog-copy`, `md-code-done`, `md-code-expand`, `md-code-lang`, `md-item-bullet`, `md-item-ordered`, `md-item-task`, `md-list-bullet`, `md-list-ordered`, `md-list-task`, `md-mermaid`, `md-mermaid-diagram`, `md-mermaid-notice`, `md-quote`, `md-table`, `md-task`, `md-task-children`, `md-task-note`, `md-tasks`, `msg-stamp`, `msg-tools`, `msg-tools-touch`, `right`, `schedule-wake-marker`, `scheduled-turn`, `side-chat-action`, `skills-summary`, `source-issue-drift`, `source-issue-echo`, `source-issue-pending`, `source-issue-retry`, `source-orchestration`, `source-orchestration-link`, `step-prompt-raw`, `task-mention`, `task-mention-tip`, `thinking-body`, `tool-output`, `transcript-col`, `transcript-fail`, `transcript-note`, `transcript-question`, `transcript-quota-wait`, `transcript-step-prompt`, `transcript-time-divider`, `user-bubble`, `verify-evidence`, `work-block`, `work-call`, `work-cancelled`, `work-earlier`, `work-say-line`, `work-spinner`, `work-summary`, `work-think`, `work-unfinished`
- Verify recipes: [.claude/skills/verify-cairn/features/board-new-task.md](features/board-new-task.md), [.claude/skills/verify-cairn/features/agent-detail.md](features/agent-detail.md)
- Research: [docs/research/r12-save-and-start-behavior.md](../../../docs/research/r12-save-and-start-behavior.md), [docs/research/r14-orchestration-parent-card.md](../../../docs/research/r14-orchestration-parent-card.md), [docs/research/branch-model-2026-11-08.md](../../../docs/research/branch-model-2026-11-08.md) (not on main), [docs/research/duet-proactive-coordinator.md](../../../docs/research/duet-proactive-coordinator.md)
- Frontend design: [docs/design/references/thread-review](../../../docs/design/references/thread-review), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md)
- Backend design: [docs/spec/23-rework-to-original-branch-and-pr-convergence.md](../../../docs/spec/23-rework-to-original-branch-and-pr-convergence.md), [docs/design/runtime-memory-out-of-tree.md](../../../docs/design/runtime-memory-out-of-tree.md), [docs/research/branch-model-2026-11-08.md](../../../docs/research/branch-model-2026-11-08.md) (not on main), [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md)
- Evidence: `apps/web/e2e/detail-continue-thread.spec.ts`, `apps/web/e2e/detail-archive.spec.ts`, `apps/server/test/archive.test.ts`, `apps/server/test/tasks.test.ts`

### desktop-app

**Desktop app** (planned, centrality 2). A web shell that bundles the server, daemon, Coordinator and tsnet, so installing it makes the machine an executor.


- Web routes: `/tray`
- Keyboard shortcuts in its code: none
- Test ids in its code: `tray-machine-meta`, `tray-popover`, `tray-quit`, `tray-rows`, `tray-runner`, `tray-usage`
- Research: [docs/research/desktop-app-stack-2026-11-08.md](../../../docs/research/desktop-app-stack-2026-11-08.md) (not on main)
- Frontend design: **gap**: no design for the window and install flow
- Backend design: **gap**: no design for packaging, process supervision, updates and data location
- Evidence: none

### first-run

**First run** (shipped, centrality 2). The setup page before the first project, the Coordinator setup prompt and the first-PR card that take a new user to a first merged PR.

States: A team with no projects lands on a full-screen two-step setup page (connect models for the Coordinator and tasks, confirm both models) with a language switch; it can be skipped, and once both steps are done it opens the Coordinator conversation. The first project waits for both steps. Afterwards, while no model source is connected, an empty Coordinator home shows one centered sentence and a primary connect-a-model-source button, and a conversation with history shows one notice line after it; a missing or offline Runner shows the same notice line; then a first-PR card.

Reach:

1. `open /app`
2. `click testid:first-run-confirm`
3. `click testid:setup-prompt-action`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `first-run-add-provider`, `first-run-back-models`, `first-run-confirm`, `first-run-continue-confirm`, `first-run-frame`, `first-run-pick-coordinator`, `first-run-remove-provider-*`, `first-run-setup`, `first-run-step-*`, `first-run-task-model-note`, `setup-prompt`, `setup-prompt-action`, `setup-prompt-hint`, `setup-prompt-label`, `setup-prompt-reconnect`
- Research: [docs/research/ui-ux-audit-2026-11-06.md](../../../docs/research/ui-ux-audit-2026-11-06.md) (not on main)
- Frontend design: [docs/design/references/first-run](../../../docs/design/references/first-run)
- Backend design: **gap**: no design for checklist state and the 10-minute path
- Evidence: `apps/web/e2e/first-run-setup.spec.ts`, `apps/web/e2e/first-run-checklist.spec.ts`

### machine-enrollment

**Machine enrollment** (shipped, centrality 2). Adding a machine: the daemon starts an enrollment, the user approves it on the authorize page in the browser.

States: A request waiting for approval, approved, expired or denied; the machine then appears in the list.

Reach:

1. `open /app/machines/authorize`

- Web routes: `/app/machines/authorize`
- Keyboard shortcuts in its code: none
- Test ids in its code: `enroll-poll-retry`, `enrollment-code-hint`, `phone-pair-entry`, `tailscale-ready`
- Research: [docs/research/machine-execution-plane.md](../../../docs/research/machine-execution-plane.md)
- Frontend design: **gap**: the add-machine dialog and authorize page have no design
- Backend design: **gap**: no design for the browser enrollment handshake and its failure modes
- Evidence: `apps/web/e2e/machine-authorize.spec.ts`, `apps/server/test/enroll-browser.test.ts`, `apps/daemon/test/machine-enroll.test.ts`

### machines

**Machines** (shipped, centrality 2). A compact machine list with names, default marker, system, online state and a menu for default and delete.

States: Empty, loading and error states; online and offline rows; default machine; long names; row menu and confirmation dialogs. No expandable details or capability controls.

Reach:

1. `settings machines`
2. `click testid:machine-menu`

- Web routes: `/app/resources/machines`, `/app/resources/machines/:id`
- Settings: `设置` (Settings) › `执行环境` (Execution) › `执行机` (Runners)
- Keyboard shortcuts in its code: none
- Test ids in its code: `machine-list`, `machines-scroll`, `resource-empty`
- Verify recipes: [.claude/skills/verify-cairn/features/machines-local-row.md](features/machines-local-row.md)
- Research: [docs/research/machine-execution-plane.md](../../../docs/research/machine-execution-plane.md), [docs/research/t3code-devices-and-scope-2026-11-06.md](../../../docs/research/t3code-devices-and-scope-2026-11-06.md) (not on main)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings), [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md)
- Backend design: [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md)
- Evidence: `apps/web/e2e/machine-detail.spec.ts`, `apps/web/e2e/machines-local.spec.ts`, `apps/server/test/machine-revoke.test.ts`

### mobile-web

**Mobile web and PWA** (shipped, centrality 2). The web app installed on a phone: narrow layouts, the service worker and the home-screen app.

States: At phone width the Coordinator home has no header bar: a round menu button, the bare status mark and one round Tasks button with its count badge float at the top, a floating pill tab bar switches chat, Tasks and results with a round computers button beside it, every side panel is a full-screen tab between them, the composer is one row, settings and usage live in the drawer footer, touch message tools appear on a tap, and the sidebar drawer pushes the conversation back as a dimmed card; settings collapse to a list; the app can be installed to the home screen.

Reach:

1. `open /app`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `narrow-menu`, `tasks-badge`, `tasks-toggle`
- Research: **gap**: no note on how Amp, t3code and Claude handle mobile web and PWA install
- Frontend design: [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md)
- Backend design: n/a: served by the same server; push is its own feature
- Evidence: `apps/web/e2e/mobile-narrow.spec.ts`, `apps/web/e2e/chief-home-phone-tabs.spec.ts`, `apps/web/e2e/chief-home-narrow-shell.spec.ts`, `apps/web/test/pwa.test.ts`

### phones

**Phone computers** (partial, centrality 2). The owner pairs a real phone over adb in Settings, Machines; the Coordinator then sees and drives it with phone_observe and phone_act, with consent, takeover and lock handback.

States: Each phone row shows not paired, pairing, ready, busy, locked, handoff or unreachable; pair failure keeps the row with its error and a retry.

Reach:

1. `settings machines`
2. `click label:添加执行机`
3. `click testid:phone-pair-entry`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `phone-forget`, `phone-name`, `phone-pair`, `phone-pair-code`, `phone-pair-consent`, `phone-pair-dialog`, `phone-pair-endpoint`, `phone-pair-name`, `phone-pair-submit`, `phone-retry`, `phone-row`, `phone-state`
- Research: [docs/research/phone-agents-2026-11-20.md](../../../docs/research/phone-agents-2026-11-20.md)
- Frontend design: [docs/design/phone-computer.md](../../../docs/design/phone-computer.md)
- Backend design: [docs/design/phone-computer.md](../../../docs/design/phone-computer.md)
- Evidence: none

### providers

**Model providers and subscriptions** (shipped, centrality 2). The user connects their own provider keys, OAuth presets and Claude or Codex subscriptions; cairn lists live models per source.

States: An empty list, providers with their models, a subscription being verified, verified or failing with a reason. Antigravity first-time host login: not installed (managed install runs first), installed but not logged in (login action shown), installing/authenticating progress, succeeded (verify turns green), cancelled or failed (plain reason plus retry), and a signed-out runner bringing the board banner back.

Reach:

1. `settings routing`
2. `click testid:routing-add-provider`
3. `click testid:subscription-verify`

- Web routes: `/app/resources/providers`
- Settings: `设置` (Settings) › `模型` (Model) › `模型` (Model)
- Keyboard shortcuts in its code: none
- Test ids in its code: `antigravity-detail-login`, `antigravity-local-hint`, `antigravity-local-import`, `antigravity-local-login`, `antigravity-local-login-cancel`, `antigravity-local-row`, `antigravity-local-skeleton`, `antigravity-paste-toggle`, `antigravity-relogin`, `antigravity-relogin-cancel`, `antigravity-subscription-label`, `antigravity-subscription-token`, `devin-local-import`, `devin-local-login`, `devin-local-login-cancel`, `devin-paste-toggle`, `devin-subscription-label`, `devin-subscription-token`, `providers-empty`, `providers-partial-error`, `subscription-label`, `subscription-token`
- Verify recipes: [.claude/skills/verify-cairn/features/providers-tabs.md](features/providers-tabs.md), [.claude/skills/verify-cairn/features/provider-picker.md](features/provider-picker.md)
- Research: [docs/research/r16-model-catalog-liveness.md](../../../docs/research/r16-model-catalog-liveness.md), [docs/research/2330-claude-entrypoint-and-setup-token-quota.md](../../../docs/research/2330-claude-entrypoint-and-setup-token-quota.md), [docs/design/devin-subscription-source.md](../../../docs/design/devin-subscription-source.md), [docs/design/antigravity-subscription-source.md](../../../docs/design/antigravity-subscription-source.md)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings), [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md)
- Backend design: [docs/design/provider-order.md](../../../docs/design/provider-order.md), [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md), [docs/research/r16-model-catalog-liveness.md](../../../docs/research/r16-model-catalog-liveness.md), [docs/design/devin-subscription-source.md](../../../docs/design/devin-subscription-source.md), [docs/design/antigravity-subscription-source.md](../../../docs/design/antigravity-subscription-source.md)
- Evidence: `apps/web/e2e/providers-claude-subscription.spec.ts`, `apps/web/e2e/provider-add-dialog.spec.ts`, `apps/web/e2e/devin-local-login.spec.ts`, `apps/web/e2e/antigravity-local-login.spec.ts`, `apps/server/test/claude-subscriptions.test.ts`, `apps/server/test/devin-subscriptions.test.ts`, `apps/server/test/antigravity-subscriptions.test.ts`, `packages/shared/test/devin-local.test.ts`, `packages/shared/test/antigravity-local.test.ts`, `packages/shared/test/antigravity-install.test.ts`, `apps/web/test/antigravity-login-warning.test.ts`, `apps/daemon/test/devin-acp.test.ts`, `apps/daemon/test/devin-managed.test.ts`, `apps/daemon/test/antigravity-acp.test.ts`, `apps/daemon/test/antigravity-managed.test.ts`

### remote-access

**Remote access over the tailnet** (partial, centrality 2). The built-in tsnet node with a route list (LAN, tailnet, Funnel), device pairing by QR code and the remote access settings page.

States: No routes, routes listed by kind, pairing blocked with a reason, or a QR code for a new device.

Reach:

1. `settings remote`
2. `click testid:pair-new-device`
3. `click testid:pairing-route-select`

- Web routes: none
- Settings: `设置` (Settings) › `安全` (Security) › `远程访问` (Remote access)
- Keyboard shortcuts in its code: none
- Test ids in its code: `clerk-account-card`, `clerk-signout-btn`, `pair-new-device`, `pair-request`, `pairing-blocked`, `pairing-route-select`, `remote-access-switch`, `remote-routes-empty`, `tailnet-login`
- Research: [docs/research/remote-access-tsnet.md](../../../docs/research/remote-access-tsnet.md), [docs/research/seamless-device-auth-2026-11-08.md](../../../docs/research/seamless-device-auth-2026-11-08.md) (not on main)
- Frontend design: **gap**: the remote access page, route list and pairing flow have no design
- Backend design: [docs/research/remote-access-tsnet.md](../../../docs/research/remote-access-tsnet.md)
- Evidence: `apps/server/test/tsnet-remote.test.ts`, `apps/server/test/remote-access.test.ts`, `apps/web/test/pairing-origin.test.ts`

### tailnet-login

**Login and tailnet device auth** (partial, centrality 2). The token gate today; next, the owner's own tailnet devices are signed in without a token.

States: Signed out shows the token gate; signed in opens the app; a tailnet device is meant to skip the gate.

Reach:

1. `open /app`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `clerk-auth-error`, `clerk-auth-not-allowed`, `clerk-auth-status`, `clerk-fallback-toggle`, `clerk-sign-in-gate`, `denied`, `expired`, `owner-token-error`, `owner-token-input`, `owner-token-submit`, `owner-token-toggle`, `pair-request-code`, `pair-request-denied`, `pair-request-expired`, `pair-request-retry`, `pair-request-unavailable`
- Research: [docs/research/seamless-device-auth-2026-11-08.md](../../../docs/research/seamless-device-auth-2026-11-08.md) (not on main)
- Frontend design: **gap**: the sign-in gate and the signed-in-by-tailnet state have no design
- Backend design: [docs/research/seamless-device-auth-2026-11-08.md](../../../docs/research/seamless-device-auth-2026-11-08.md) (not on main), [docs/design/pairing-gate-close.md](../../../docs/design/pairing-gate-close.md)
- Evidence: `apps/web/e2e/token-gate.spec.ts`, `apps/web/test/auth-gate-close.test.ts`, `apps/server/test/browser-session-status.test.ts`, `apps/server/test/token-auth.test.ts`, `apps/server/test/tailnet-listener.test.ts`

### token-usage

**Token usage** (shipped, centrality 2). The Usage dialog from the sidebar footer: a past-year heatmap of tokens per local day, year totals with days used, daily average and cache hit, the token-type bar, and models and projects ranked for the year or the clicked day.

States: Loading, failed with retry, empty for a new team, a new user with a started-on line under the heatmap, a full year with a readout for the hovered or selected day, and a selected day scoping the rankings; light and dark, desktop dialog and phone (16 weeks).

Reach:

1. `open /app`
2. `click testid:sidebar-usage`

- Web routes: `/app/usage`
- Keyboard shortcuts in its code: none
- Test ids in its code: `usage-current-month`, `usage-date-filter`, `usage-empty`, `usage-error`, `usage-heatmap`, `usage-heatmap-frame`, `usage-legend`, `usage-mix`, `usage-models`, `usage-projects`, `usage-readout`, `usage-since`, `usage-stats`, `usage-year`
- Research: **gap**: no note beyond GitHub's contribution calendar, which the owner named
- Frontend design: [docs/design/references/thread-list-sidebar](../../../docs/design/references/thread-list-sidebar)
- Backend design: [docs/design/step-usage-daily.md](../../../docs/design/step-usage-daily.md)
- Evidence: `apps/web/e2e/usage-page.spec.ts`, `apps/web/test/usage-model.test.ts`, `apps/server/test/step-usage-daily.test.ts`

### account-and-team

**Account and team** (shipped, centrality 3). The user's account, language, global external-actions tier and device notification preferences.

States: Account details, language selection, the team-wide external-actions tier projects follow by default, and device push enabled or disabled.

Reach:

1. `settings account`

- Web routes: `/app/account`
- Settings: `设置` (Settings) › `账号` (Account)
- Keyboard shortcuts in its code: none
- Test ids in its code: `account-appearance`
- Verify recipes: [.claude/skills/verify-cairn/features/avatars.md](features/avatars.md)
- Research: [docs/research/bot-identity-and-coauthorship-2026-11-07.md](../../../docs/research/bot-identity-and-coauthorship-2026-11-07.md)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: **gap**: no design for the single-user account and team record
- Evidence: `apps/web/e2e/account-controls.spec.ts`, `apps/web/e2e/account-release-removal.spec.ts`, `apps/web/e2e/push-device-switch.spec.ts`, `apps/server/test/user-patch.test.ts`

### api-keys

**API keys** (shipped, centrality 3). API keys with grants for scripts and external harnesses.

States: An empty state, a list of keys, and a create dialog with grants; the key is shown once; each row deletes its key after a confirmation.

Reach:

1. `settings api-keys`
2. `click testid:keys-empty`

- Web routes: `/app/api-keys`
- Settings: `设置` (Settings) › `安全` (Security) › `API 密钥` (API keys)
- Keyboard shortcuts in its code: none
- Test ids in its code: `api-key-delete`, `api-key-row`, `keys-empty`
- Verify recipes: [.claude/skills/verify-cairn/features/api-keys.md](features/api-keys.md)
- Research: **gap**: no note on API key and grant models in reference products
- Frontend design: **gap**: the API keys page and grant picker have no design
- Backend design: **gap**: no design for key scopes, grants and revocation
- Evidence: `apps/web/e2e/api-key-grants.spec.ts`, `apps/web/test/api-key-mcp-grants.test.ts`

### app-shell

**App shell and settings window** (shipped, centrality 3). The served single-page app, the live team event stream, and the settings window that hosts every section.

States: The settings window with grouped navigation, a search field that typing with nothing focused fills, a breadcrumb, and the live stream reconnecting after a drop.

Reach:

1. `open /app/settings`
2. `click testid:settings-search`

- Web routes: `/app/settings/:section?`
- Keyboard shortcuts in its code: none
- Test ids in its code: `settings-body`, `settings-content`, `settings-head`, `settings-title`
- Verify recipes: [.claude/skills/verify-cairn/features/hotkeys.md](features/hotkeys.md), [.claude/skills/verify-cairn/features/persona-verify.md](features/persona-verify.md)
- Research: [docs/research/ai-frontend-quality-2026-11-06.md](../../../docs/research/ai-frontend-quality-2026-11-06.md) (not on main), [docs/research/ui-ux-audit-2026-11-06.md](../../../docs/research/ui-ux-audit-2026-11-06.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: n/a: static serving, a server-sent event stream and two no-op analytics sinks (see docs/privacy.md)
- Evidence: `apps/web/e2e/settings-master-detail.spec.ts`, `apps/web/e2e/shell-consistency.spec.ts`, `apps/server/test/sse.test.ts`

### appearance

**Appearance and visual system** (shipped, centrality 3). Theme, type and the visual language every page follows.

States: Light, dark or system theme, applied immediately.

Reach:

1. `settings account`

- Web routes: none
- Settings: `设置` (Settings) › `账号` (Account)
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/theme.md](features/theme.md)
- Research: [docs/research/ai-frontend-quality-2026-11-06.md](../../../docs/research/ai-frontend-quality-2026-11-06.md) (not on main), [docs/research/serif-typography-2026-11-08.md](../../../docs/research/serif-typography-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/settings](../../../docs/design/references/settings), [docs/spec/base-ui-theme.md](../../../docs/spec/base-ui-theme.md)
- Backend design: n/a: a client setting with no server state
- Evidence: `apps/web/e2e/theme-toggle.spec.ts`, `apps/web/test/anti-slop-foundations.test.ts`

### attachments

**Attachments** (shipped, centrality 3). Files dropped, pasted or picked into a composer and files agents attach to threads, uploaded by grant and reclaimed later; a sent attachment is a card above the user's message, with its type glyph and first lines, that opens by kind: images and video in a full-window lightbox with a zoned top bar, a filmstrip of the message's media and peeks of the adjacent files; documents (Markdown with a preview/source switch, code with muted highlighting, text, PDF, office) in a right side panel inside the Coordinator layout, one at a time.

States: Composer tile uploading (grey pulse), ready, failed (removable) and the drop-target outline; sent attachment card with type glyph, first-line preview or video frame; inline chat image, inline video and file card; artifact panel with several tabs, full screen, the phone chat/file switch, version history and an old version banner, for an image, a video, text and code with line numbers, Markdown preview and source, an office document, an unsupported type, loading and a load error; agent attachments in the thread transcript.

Reach:

1. `open /app`
2. `click testid:chief-sent-attachment`

- Web routes: none
- Keyboard shortcuts in its code: `B`, `D`
- Test ids in its code: `artifact-body`, `artifact-chat-bar`, `artifact-close`, `artifact-comment-count`, `artifact-comment-toggle`, `artifact-copy`, `artifact-download`, `artifact-export`, `artifact-full`, `artifact-history`, `artifact-history-close`, `artifact-history-toggle`, `artifact-loading`, `artifact-name`, `artifact-open-browser`, `artifact-panel`, `artifact-pdf-page`, `artifact-tab`, `artifact-tab-close`, `artifact-toolbar`, `artifact-version`, `artifact-version-banner`, `artifact-version-current`, `artifact-version-restore`, `artifact-whiteboard-edit`, `attachment-pending`, `attachment-tile-preview`, `attachment-tile-video`, `chat-artifact-card`, `chat-artifact-image`, `chat-artifact-meta`, `chat-artifact-video`, `chat-artifact-video-open`, `chief-sent-attachment`, `chief-sent-attachments`, `composer-attachments`
- Verify recipes: [.claude/skills/verify-cairn/features/attachments.md](features/attachments.md)
- Research: [docs/research/file-preview-reference-2026-11-11.md](../../../docs/research/file-preview-reference-2026-11-11.md)
- Frontend design: [docs/design/references/coordinator-chat/claude-duet-composer-attachment.jpg](../../../docs/design/references/coordinator-chat/claude-duet-composer-attachment.jpg), [docs/design/references/coordinator-chat/claude-duet-file-preview-panel.jpg](../../../docs/design/references/coordinator-chat/claude-duet-file-preview-panel.jpg), [docs/design/references/coordinator-chat/claude-duet-sent-attachment-uploading.jpg](../../../docs/design/references/coordinator-chat/claude-duet-sent-attachment-uploading.jpg)
- Backend design: [docs/spec/20-attachment-reclaim-strategy.md](../../../docs/spec/20-attachment-reclaim-strategy.md), [docs/design/side-panels-backend-gaps.md](../../../docs/design/side-panels-backend-gaps.md)
- Evidence: `apps/web/e2e/attachment-strip.spec.ts`, `apps/web/e2e/chief-files.spec.ts`, `apps/web/e2e/detail-agent-attachments.spec.ts`, `apps/server/test/attachments.test.ts`

### composer

**Composer** (shipped, centrality 3). The message composer: mentions, named prompts and drafts that survive closing the app. A leading / is plain text; there is no slash-command menu.

States: Empty with a placeholder, a draft restored after reload, mention suggestions open, and a send error.

Reach:

1. `open /app`
2. `click testid:chief-composer-block`
3. `type @ to mention`

- Web routes: none
- Keyboard shortcuts in its code: `A`
- Test ids in its code: `chief-composer-input`, `chief-composer-placeholder`, `composer-plus`
- Verify recipes: [.claude/skills/verify-cairn/features/mentions.md](features/mentions.md), [.claude/skills/verify-cairn/features/failed-send.md](features/failed-send.md), [.claude/skills/verify-cairn/features/hotkeys.md](features/hotkeys.md)
- Research: **gap**: no note comparing composers in claude.ai, Amp and t3code
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat)
- Backend design: **gap**: no design for server drafts  and named prompts
- Evidence: `apps/web/e2e/chief-draft-persist.spec.ts`, `apps/server/test/composer-drafts.test.ts`

### coordinator-mcp

**Coordinator over MCP** (shipped, centrality 3). External harnesses (Claude Code, Codex, pi) talk to the Coordinator and threads through cairn's MCP endpoint.

States: No page; an external harness connects with an API key that grants MCP access.

Reach:

1. `settings api-keys`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: **gap**: the t3code comparison of plan §21 is not in the repository
- Frontend design: n/a: an API for other harnesses with no page
- Backend design: [docs/research/desktop-mobile-mcp-forms-2026-11-08.md](../../../docs/research/desktop-mobile-mcp-forms-2026-11-08.md)
- Evidence: `apps/server/test/mcp-face.test.ts`, `integration/test/m4b-mcp-e2e.test.ts`

### design-surface

**Design surface** (partial, centrality 3). Pages a task makes (deliverable pages and attached .html files) become versions served by Cairn under Open Design's sandbox; the design view previews them beside the Coordinator chat with viewports, versions and restore, element comments forwarded to the task, mark-up, export and share through the user's relay.

States: Page with one version, several versions, a restored version, a missing version file; viewports desktop, tablet, phone; comment mode hover and popover, pending chips, sent and resolved comments, a lost anchor; mark-up drawing and saved mark; export menu; share without a relay (HTML download and relay message) and with a relay link.

Reach:

1. `open /app`
2. `click label:成果`
3. `click testid:made-card`
4. `click testid:made-file-open`
5. `click testid:artifact-history-toggle`

- Web routes: none
- Keyboard shortcuts in its code: `B`, `D`, `F`, `H`, `P`, `R`, `Z`
- Test ids in its code: `artifact-comment-exit`, `artifact-comment-strip`, `design-canvas`, `design-comment-cancel`, `design-comment-chip`, `design-comment-chip-remove`, `design-comment-chips`, `design-comment-delete`, `design-comment-edit`, `design-comment-edit-note`, `design-comment-edit-save`, `design-comment-list`, `design-comment-list-close`, `design-comment-lost`, `design-comment-mark`, `design-comment-moved`, `design-comment-note`, `design-comment-popover`, `design-comment-reopen`, `design-comment-resolve`, `design-comment-retarget`, `design-comment-row`, `design-comment-save`, `design-comment-send`, `design-comment-send-all`, `design-comment-stale`, `design-comment-state`, `design-comment-target`, `design-comment-unsupported`, `design-comment-where`, `design-comments-empty`, `design-download`, `design-error`, `design-export`, `design-export-html`, `design-export-pdf`, `design-export-png`, `design-export-zip`, `design-frame`, `design-hover-outline`, `design-inspect`, `design-loading`, `design-mark-bar`, `design-mark-cancel`, `design-mark-note`, `design-mark-redo`, `design-mark-save`, `design-mark-send`, `design-mark-undo`, `design-missing`, `design-open-browser`, `design-overlay`, `design-pin`, `design-share`, `design-share-copy`, `design-share-create`, `design-share-live`, `design-share-no-relay`, `design-share-off`, `design-share-popover`, `design-share-relay-settings`, `design-share-stop`, `design-share-url`, `design-source`, `design-source-toggle`, `design-stage`
- Verify recipes: [.claude/skills/verify-cairn/features/design-surface.md](features/design-surface.md)
- Research: [docs/research/open-design-2026-11-20.md](../../../docs/research/open-design-2026-11-20.md)
- Frontend design: [docs/design/design-surface.md](../../../docs/design/design-surface.md)
- Backend design: [docs/design/design-surface.md](../../../docs/design/design-surface.md)
- Evidence: none

### git-hosting

**Built-in git hosting** (shipped, centrality 3). The server serves git for local projects so machines can fetch and push without GitHub.

States: No page; local projects fetch and push through it.

Reach:

1. `open /app/project/<id of a project listed by the projects API>`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: **gap**: no note on serving git over HTTP versus other transports
- Frontend design: n/a: a git endpoint with no page
- Backend design: **gap**: no design for auth, repository layout and failure modes
- Evidence: `apps/server/test/git-hosting.test.ts`

### github

**GitHub connection and issues** (shipped, centrality 3). Connecting GitHub, choosing repositories, importing labeled issues as threads and writing results back to the issue.

States: Not connected, connected with a repository picker, an issue imported as a thread, and the write-back pending, done, drifted or failed with retry.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:source-issue-retry`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `source-issue-drift`, `source-issue-echo`, `source-issue-pending`, `source-issue-retry`, `source-orchestration`, `source-orchestration-link`
- Verify recipes: [.claude/skills/verify-cairn/features/github-oauth-picker.md](features/github-oauth-picker.md), [.claude/skills/verify-cairn/features/github-emulator.md](features/github-emulator.md), [.claude/skills/verify-cairn/features/github-auth-emulator.md](features/github-auth-emulator.md)
- Research: [docs/research/bot-identity-and-coauthorship-2026-11-07.md](../../../docs/research/bot-identity-and-coauthorship-2026-11-07.md)
- Frontend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Backend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Evidence: `apps/web/e2e/github-issue-writeback.spec.ts`, `apps/server/test/github-issues.test.ts`, `apps/server/test/github-connection.test.ts`

### im-connections

**IM connections** (partial, centrality 3). Outbound-only chat connections that reach the Coordinator without a native app or a public callback. Telegram connects with a bot token; WeChat connects by scanning a Tencent iLink QR that creates the connection and pairs the scanning account; Slack connects with an app-level token and bot token over Socket Mode; iMessage bridges through imsg on a registered always-on Mac over the machine stream, with no inbound port. Paired senders' messages become coordinator turns, card answers arrive as button taps or replies, and text replies return to the same chat.

States: An empty connections list, a connecting/ready/degraded/expired/error status per connection, a pending WeChat QR login that turns done or expired, pending pairing requests with approve/reject, paired senders listed under the connection, and an iMessage connection bound to a registered machine that reports the bridge's status.

Reach:

1. `settings im`
2. `click testid:im-connect-telegram`
3. `click testid:im-connect-wechat`
4. `click testid:im-connect-slack`
5. `click testid:im-connect-imessage`

- Web routes: none
- Settings: `设置` (Settings) › `消息` (Messages) › `聊天应用` (Chat apps)
- Keyboard shortcuts in its code: `C`, `D`
- Test ids in its code: `im-app-token-input`, `im-approve-*`, `im-bot-token-input`, `im-connect-*`, `im-connect-another-*`, `im-connect-submit`, `im-connection-*`, `im-delete-*`, `im-machine-select`, `im-menu-*`, `im-no-machines`, `im-pairing-*`, `im-platform-*`, `im-platforms`, `im-reconnect-*`, `im-reject-*`, `im-rescan-*`, `im-token-input`, `im-wechat-expired`, `im-wechat-retry`
- Research: n/a: the binding contract is docs/design/im-connections.md; no reference product is copied
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: [docs/design/im-connections.md](../../../docs/design/im-connections.md), [docs/design/im-bridge.md](../../../docs/design/im-bridge.md)
- Evidence: `apps/server/test/im-telegram.test.ts`, `apps/server/test/im-wechat.test.ts`, `apps/server/test/im-slack.test.ts`, `apps/server/test/im-core.test.ts`, `apps/server/test/im-routes.test.ts`, `apps/server/test/im-imessage.test.ts`, `apps/daemon/test/imsg-bridge.test.ts`

### mail-connector

**Mailbox connector** (partial, centrality 3). The owner connects an IMAP mailbox (QQ Mail authorization code, Gmail or Outlook app password). One held IDLE connection per mailbox turns new mail into a mail-provenance Coordinator turn with the mail fenced as untrusted data; replies go out over SMTP only after an approval card.

States: Mail cards under Available on the MCP page, then under Connected once a mailbox is connected, with a Manage dialog; connecting, connected, error (rejected login or unreachable server, with the reason), a last-mail time, wake rules (all new mail or matching sender/subject), and an approval card for every reply.

Reach:

1. `settings mcp`

- Web routes: none
- Settings: `设置` (Settings) › `执行环境` (Execution) › `应用` (Apps)
- Keyboard shortcuts in its code: none
- Test ids in its code: `mail-account-*`, `mail-add`, `mail-address-input`, `mail-connect-submit`, `mail-imap-host-input`, `mail-imap-port-input`, `mail-password-input`, `mail-remove-*`, `mail-retry-*`, `mail-rule-*`, `mail-rule-add`, `mail-rule-pattern-input`, `mail-rule-remove-*`, `mail-rules-*`, `mail-smtp-host-input`, `mail-smtp-port-input`
- Research: n/a: the binding contract is docs/design/mail-connector.md; no reference product is copied
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: [docs/design/mail-connector.md](../../../docs/design/mail-connector.md)
- Evidence: `apps/server/test/mail-imap.test.ts`, `apps/server/test/mail-connector.test.ts`

### mcp-servers

**MCP servers** (shipped, centrality 3). Connect remote MCP servers from a catalog or by URL and see the local servers each machine configures; every task and review uses what is connected.

States: Catalog cards connected, needing sign-in, or failing; add-server dialog; manage dialog; local servers per machine, or empty.

Reach:

1. `settings mcp`
2. `click testid:resource-row`

- Web routes: `/app/resources/mcp-servers`
- Settings: `设置` (Settings) › `执行环境` (Execution) › `应用` (Apps)
- Keyboard shortcuts in its code: none
- Test ids in its code: `composio-authorize-*`, `composio-cancel-auth-*`, `composio-connect-*`, `composio-error-banner`, `composio-error-manage-key`, `composio-error-retry`, `composio-key-change`, `composio-key-input`, `composio-key-remove`, `composio-key-save`, `composio-open-auth-*`, `composio-reconnect-*`, `composio-remove-*`, `composio-setup-open`, `mcp-add-server`, `mcp-catalog`, `mcp-connected`, `mcp-local`, `mcp-oauth-error`
- Verify recipes: [.claude/skills/verify-cairn/features/mcp-servers.md](features/mcp-servers.md)
- Research: [docs/research/mcp-connectors-2026-11-15.md](../../../docs/research/mcp-connectors-2026-11-15.md)
- Frontend design: [docs/spec/13-resources-view-localization.md](../../../docs/spec/13-resources-view-localization.md), [docs/design/mcp-connectors.md](../../../docs/design/mcp-connectors.md), [docs/design/connector-fabric.md](../../../docs/design/connector-fabric.md)
- Backend design: [docs/spec/13-resources-view-localization.md](../../../docs/spec/13-resources-view-localization.md), [docs/design/mcp-connectors.md](../../../docs/design/mcp-connectors.md), [docs/design/connector-fabric.md](../../../docs/design/connector-fabric.md)
- Evidence: `apps/server/test/mcp-servers.test.ts`, `apps/server/test/composio.test.ts`, `apps/server/test/connector-broker.test.ts`, `apps/server/test/composio-migration.test.ts`, `apps/daemon/test/mcp-config.test.ts`

### projects

**Projects** (shipped, centrality 3). Projects as filter and context: create from a local repo or GitHub, a project conversation, settings (base branch, concurrency, autonomy, instructions, local-to-GitHub conversion), archive, unarchive from the sidebar's archived filter, and an archived project opened read-only; the UI offers no project deletion.

States: A new-project form for a local folder or a GitHub repository, a project conversation, settings for base branch, concurrency, autonomy and instructions, archived. A GitHub project has no local speed-up path: the accelerator was removed by the owner on 2026-11-20, so it always runs from its clone and a conversion from a local folder drops that folder. The autonomy card's external-actions tier follows the global setting or pins its own ask-first or full-access tier.

Reach:

1. `open /app/project/new`
2. `click testid:github-picker`
3. `open /app/project/<id of a project listed by the projects API>/settings`
4. `click testid:project-instructions-input`

- Web routes: `/app/project/:id`, `/app/project/:id/settings`, `/app/project/:id/tasks`, `/app/project/new`
- Keyboard shortcuts in its code: `G`, `L`, `M`, `N`
- Test ids in its code: `project-archive`, `project-goal-input`, `project-model-coordinator`, `project-name-input`, `project-new-blocked`, `project-settings-body`, `project-settings-missing`
- Verify recipes: [.claude/skills/verify-cairn/features/project-new-form.md](features/project-new-form.md), [.claude/skills/verify-cairn/features/github-oauth-picker.md](features/github-oauth-picker.md), [.claude/skills/verify-cairn/features/local-repo-api.md](features/local-repo-api.md)
- Research: [docs/research/project-coordinators.md](../../../docs/research/project-coordinators.md) (not on main), [docs/research/project-files-retirement-2026-11-09.md](../../../docs/research/project-files-retirement-2026-11-09.md), [docs/research/archived-projects-entry-2026-11-09.md](../../../docs/research/archived-projects-entry-2026-11-09.md)
- Frontend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/archived-projects-settings.md](../../../docs/design/archived-projects-settings.md)
- Backend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Evidence: `apps/web/e2e/project-new-repo.spec.ts`, `apps/server/test/project-delete.test.ts`

### quota-wait

**Quota wait** (shipped, centrality 3). When a subscription hits its limit, threads wait for the reset and the board says so.

States: A banner on the board while a subscription waits for its reset; threads show they are waiting for quota.

Reach:

1. `open /app`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/2330-claude-entrypoint-and-setup-token-quota.md](../../../docs/research/2330-claude-entrypoint-and-setup-token-quota.md)
- Frontend design: **gap**: the quota banner and waiting thread state have no design
- Backend design: **gap**: no design for rate-limit events, account cooldown and resume
- Evidence: `apps/web/e2e/quota-wait-board.spec.ts`, `apps/server/test/quota-wait.test.ts`, `apps/server/test/claude-rate-limit.test.ts`

### research-loop

**Research before retry and plan** (shipped, centrality 3). Threads research outward when a fix keeps failing or a new mechanism is planned, and cite sources in their plan.

States: Research runs show as transcript rows with cited sources before a retry or a plan.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:side-chat`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/research-loop-plan.md](../../../docs/research/research-loop-plan.md)
- Frontend design: n/a: research runs inside threads and shows as ordinary transcript rows
- Backend design: [docs/research/research-loop-plan.md](../../../docs/research/research-loop-plan.md)
- Evidence: `apps/server/test/research-trigger.test.ts`, `apps/server/test/chief-router-tools.test.ts`, `apps/daemon/test/web-search.test.ts`

### schedules

**Scheduled tasks** (shipped, centrality 3). Recurring work that starts or continues threads on a schedule, with run-now and a project schedule.

States: Loading, empty, a list of schedules with cadence in the Tasks panel Schedules tab, a small popover editor with run now, a collapsed ended group, and an error state.

Reach:

1. `open /app`
2. `click testid:sidebar-schedules`
3. `click testid:schedule-new`

- Web routes: `/app/schedules`
- Keyboard shortcuts in its code: `D`, `E`, `N`, `P`
- Test ids in its code: `schedule-new`, `schedule-popover`, `schedule-popover-runs`, `schedule-row-menu-button`, `schedule-webhook-copy`, `schedule-webhook-masked`, `schedule-webhook-rotate`, `schedule-webhook-url`, `schedules-ended`, `tasks-section`
- Research: **gap**: no note on Claude Code scheduled tasks, Amp and the Durable Objects alarm model
- Frontend design: **gap**: the Tasks panel Schedules tab and its popover editor have no design note beyond DESIGN.md
- Backend design: **gap**: no design for due events, missed runs and continue-thread schedules
- Evidence: `apps/web/e2e/schedules-live.spec.ts`, `apps/server/test/schedules.test.ts`, `apps/server/test/due-events.test.ts`

### search

**Search** (shipped, centrality 3). The search palette with its query syntax.

States: The search palette with syntax help, query chips, filter problems and a failed-search retry.

Reach:

1. `open /app`
2. `press Mod+K`

- Web routes: none
- Keyboard shortcuts in its code: `Mod+K`
- Test ids in its code: `chip-problems`, `query-chip`, `search-context`, `search-error`, `syntax-help`
- Verify recipes: [.claude/skills/verify-cairn/features/search.md](features/search.md)
- Research: **gap**: no note on Amp's search syntax and filters
- Frontend design: [docs/design/references/thread-list-sidebar](../../../docs/design/references/thread-list-sidebar), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md)
- Backend design: **gap**: no design for the search syntax, index and ranking
- Evidence: `apps/web/e2e/search-syntax-palette.spec.ts`, `apps/server/test/search-syntax.test.ts`

### secrets

**Secrets** (shipped, centrality 3). Encrypted secrets and readable environment variables; first-use browser passwords ask for website approval in chat; the vault settings section lists saved site logins and per-site fill authorizations.

States: Original add/edit form with name, value and secret checkbox; browser website approval pending, refused or approved; subsequent same-site fills; reapproval after password, website or machine changes; vault section lists login pairs masked, empty state, and grants active/stale/revoked with revoke. In-chat secret card from the Coordinator (request_secret): pending with the value field, saved, not provided, request ended, replaces-existing note, project scope, ended-request and owner-only refusals.

Reach:

1. `settings secrets`
2. `click testid:resource-new`
3. `click label:机密`
4. `settings vault`
5. `click label:添加登录`

- Web routes: `/app/resources/secrets`
- Settings: `设置` (Settings) › `安全` (Security) › `密钥与环境变量` (Secrets & env vars); `设置` (Settings) › `安全` (Security) › `保险库` (Vault)
- Keyboard shortcuts in its code: `D`, `E`, `S`
- Test ids in its code: `bulk-secret-preview`, `chief-secret-request`, `chief-secret-request-input`, `pair-name`, `pair-password`, `pair-site`, `pair-username`, `resource-empty`, `secret-bulk`, `secret-convert-confirm`, `secret-kind`, `secret-menu`, `secret-menu-convert`, `secret-menu-delete`, `secret-menu-edit`, `secret-scope`, `secret-value`, `vault-empty`, `vault-entry-delete`, `vault-entry-edit`, `vault-entry-menu`, `vault-grant-revoke`, `vault-new`
- Research: [docs/research/1775-gateway-prior-art.md](../../../docs/research/1775-gateway-prior-art.md), [docs/research/browser-secret-fill-2026-11-16.md](../../../docs/research/browser-secret-fill-2026-11-16.md)
- Frontend design: [docs/design/browser-secret-fill.md](../../../docs/design/browser-secret-fill.md)
- Backend design: [docs/research/1775-secret-gateway-design.md](../../../docs/research/1775-secret-gateway-design.md), [docs/design/browser-secret-fill.md](../../../docs/design/browser-secret-fill.md), [docs/design/secret-request-card.md](../../../docs/design/secret-request-card.md)
- Evidence: `apps/web/e2e/secret-add-dialog.spec.ts`, `apps/web/e2e/project-secrets.spec.ts`, `apps/server/test/project-secrets.test.ts`, `apps/server/test/secret-delivery-policy.test.ts`, `apps/server/test/computer-login-handoff.test.ts`, `apps/server/test/browser-password-vault.test.ts`, `apps/daemon/test/browser-secret-fill.test.ts`, `apps/web/e2e/vault.spec.ts`, `apps/web/e2e/chief-secret-request-card.spec.ts`, `apps/web/test/chief-secret-request-card.test.ts`, `apps/server/test/secret-request.test.ts`, `apps/server/test/coordinator/secret-request.test.ts`

### server-status

**Server backup and deploy status** (shipped, centrality 3). Banners that warn when backups are stale or the deployed server lags main.

States: Hidden while healthy; a warning banner when backups are stale or the deploy lags.

Reach:

1. `open /app`
2. `click testid:backup-warning`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `backup-warning`
- Research: [docs/research/deploy-drain-2026-11-09.md](../../../docs/research/deploy-drain-2026-11-09.md)
- Frontend design: **gap**: the banners have no design
- Backend design: [docs/ops/deploy-drain-design.md](../../../docs/ops/deploy-drain-design.md)
- Evidence: `apps/web/e2e/chief-home-backup.spec.ts`, `apps/server/test/backup-status.test.ts`, `apps/server/test/deploy-status.test.ts`, `apps/server/test/deploy-lease.test.ts`, `integration/test/deploy-server-restart.test.ts`, `scripts/ops/deploy-self.test.mjs`

### sidebar

**Sidebar** (shipped, centrality 3). The sidebar tree: the Coordinator row with its projects hung under it on a tree guide, owner-made project groups as folder rows, a needs-you dot, the project menu (rename, project settings, move to group, archive), the group menu, the project filter (active, archived, all) with the archived row menu (unarchive) and the machine-status footer.

States: Projects under the Coordinator with no group, ungrouped projects then groups in name order, a folded group with its count, an ochre dot on a project with a task waiting on the owner, the open row menu, loading or error rows, the filter on archived (note, archived rows with their groups, back row) or empty archived, the filter on all with archived rows marked, an archived project opened read-only with the unarchive bar, and collapsed with only the toggle, whose hover, edge or keyboard focus floats the whole sidebar as a peek.

Reach:

1. `open /app`
2. `click testid:project-group-header`
3. `click testid:sidebar-project-filter`
4. `click testid:sidebar-project-filter-archived`
5. `click testid:archived-project-bar-unarchive`

- Web routes: none
- Keyboard shortcuts in its code: `A`, `M`, `N`, `R`, `S`, `U`
- Test ids in its code: `archived-project-bar`, `archived-project-bar-unarchive`, `project-group-header`, `sidebar-archived-empty`, `sidebar-archived-page`, `sidebar-coordinator-memory`, `sidebar-feedback`, `sidebar-footer`, `sidebar-footer-brand`, `sidebar-pinned`, `sidebar-project-filter`, `sidebar-project-filter-*`, `sidebar-projects-error`, `sidebar-projects-loading`, `sidebar-schedules`, `sidebar-settings`, `sidebar-usage`, `team-row`
- Research: [docs/research/sidebar-coordinator-icon-2026-11-08.md](../../../docs/research/sidebar-coordinator-icon-2026-11-08.md) (not on main), [docs/research/archived-projects-entry-2026-11-09.md](../../../docs/research/archived-projects-entry-2026-11-09.md)
- Frontend design: [docs/design/references/thread-list-sidebar](../../../docs/design/references/thread-list-sidebar), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/archived-projects-settings.md](../../../docs/design/archived-projects-settings.md)
- Backend design: **gap**: no design for unread and read marks across devices
- Evidence: `apps/web/e2e/sidebar-nav.spec.ts`, `apps/web/e2e/sidebar-projects.spec.ts`, `apps/web/e2e/sidebar-visual.spec.ts`, `apps/web/e2e/sidebar-archived.spec.ts`, `apps/server/test/unread-notifications.test.ts`

### skills

**Skills** (shipped, centrality 3). Skills read from each machine and team skills imported and injected into threads.

States: An empty list, skills per machine, an import dialog with a pick-from-this-machine tab (imported and unimportable skills disabled, one error per failed pick) and a path or GitHub tab, and a skill injected into a thread shown in the transcript.

Reach:

1. `settings skills`
2. `click testid:resource-import`

- Web routes: `/app/resources/skills`
- Settings: `设置` (Settings) › `执行环境` (Execution) › `技能` (Skills)
- Keyboard shortcuts in its code: none
- Test ids in its code: `resource-empty`, `resource-import`, `skill-candidate`, `skill-candidate-all`, `skill-candidates`, `skill-candidates-empty`, `skill-import-source`, `skill-search-empty`
- Verify recipes: [.claude/skills/verify-cairn/features/skills-page.md](features/skills-page.md), [.claude/skills/verify-cairn/features/skill-import.md](features/skill-import.md), [.claude/skills/verify-cairn/features/skills-injection.md](features/skills-injection.md)
- Research: **gap**: no current note on how Amp, t3code and Claude Code manage skills across machines
- Frontend design: [docs/spec/13-resources-view-localization.md](../../../docs/spec/13-resources-view-localization.md)
- Backend design: [docs/spec/14-skills-execution-surface-injection.md](../../../docs/spec/14-skills-execution-surface-injection.md)
- Evidence: `apps/web/e2e/skills-page.spec.ts`, `apps/web/e2e/skill-import.spec.ts`, `apps/server/test/skill-import.test.ts`, `apps/daemon/test/skills-catalog.test.ts`

### git-release-tags

**Git release tags** (shipped, centrality 4). The existing daemon-local create_tag tool creates and pushes annotated Git tags, independently of task categories.

States: Repository-bound invocation, successful tag push, invalid input or Git failure; no product page.

Reach:

1. `open /app`
2. `type a repository task whose worker claim enables create_tag`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/thread-category-runtime-cutover-3481.md](../../../docs/research/thread-category-runtime-cutover-3481.md)
- Frontend design: n/a: an existing daemon-local repository tool with no UI
- Backend design: [docs/research/thread-category-runtime-cutover-3481.md](../../../docs/research/thread-category-runtime-cutover-3481.md)
- Evidence: `apps/daemon/test/tag-tool.test.ts`, `apps/daemon/test/runner-create-tag.test.ts`

### ios-app

**iOS app** (planned, centrality 4). A native phone app with Live Activities, forked from Optio or t3code when the time comes.


- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: **gap**: the Optio and t3code comparison has not been done
- Frontend design: **gap**: not designed
- Backend design: **gap**: not designed
- Evidence: none

### thread-tags

**Thread tags** (shipped, centrality 4). Category UI, vocabulary, seeding, assignment writers and legacy storage are fully removed; the tag/todo_tag tables and tagIds wire fields are gone.

States: Vocabulary GET/POST return 404; no category seeding remains. Retired tagIds are ignored or rejected before writes across REST/Coordinator/MCP and canonical services, including SDK transports. github_label/todo_github_label are the only label state.

Reach:

1. `open /app/project/<id of a project listed by the projects API>`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/tags.md](features/tags.md)
- Research: [docs/research/thread-category-runtime-cutover-3481.md](../../../docs/research/thread-category-runtime-cutover-3481.md)
- Frontend design: [docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md](../../../docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md)
- Backend design: [docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md](../../../docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md)
- Evidence: `apps/server/test/task-meta.test.ts`, `apps/server/test/category-vocabulary-retirement.test.ts`, `apps/server/test/category-assignment-retirement.test.ts`, `packages/shared/test/task-request.test.ts`, `apps/server/test/retire-tag-tables-migration.test.ts`, `apps/server/test/correction-classification.test.ts`, `apps/daemon/test/task-meta-prompt.test.ts`, `apps/daemon/test/worker-meta-sdk.test.ts`

# Feature map

> Generated from `feature-map.json` in this directory by `scripts/generate-feature-map.mjs`. Edit the JSON, then run `node scripts/generate-feature-map.mjs`. The `gates` CI job runs it with `--check` and fails when this file drifts from the code.

Use it to turn a vague report or screenshot into exact steps: find the feature by what is on screen (test ids, labels, routes), follow its reach steps on the stack from `vp.mjs launch`, then drive the recipe under `features/` when one is listed. Reach steps use `open <route>`, `settings <section>`, `click testid:<id>`, `click label:<source label>`, `hover ...`, `press <keys>` and `type <text>`; every route, section, test id, label and key in them is checked against the source. A label is the zh source string passed to `t()`; the English UI shows the translation printed next to it. A `<...>` path segment is a parameter to bind on the launched stack, such as a thread id from `GET /api/todos`; route templates like `:id` are rejected.

Routes, settings paths, keyboard shortcuts and test ids below are extracted from `apps/web/src`, never typed by hand. `Mod` is Cmd on macOS and Ctrl elsewhere; a single letter is a menu key that works while its menu is open.

## Settings sections

| Section | Path in the settings window | Feature |
|---|---|---|
| `account` | `设置` (Settings) › `账号` (Account) | [Account and team](#account-and-team) |
| `appearance` | `设置` (Settings) › `外观` (Appearance) | [Appearance and visual system](#appearance) |
| `projects` | `设置` (Settings) › `项目` | [Projects](#projects) |
| `providers` | `设置` (Settings) › `模型` (Model) › `模型服务` (Providers) | [Model providers and subscriptions](#providers) |
| `routing` | `设置` (Settings) › `模型` (Model) › `用量与连接` (Usage & connections) | [Model and work routing](#routing) |
| `work-routing` | `设置` (Settings) › `模型` (Model) › `规则与策略` (Rules & policies) | [Model and work routing](#routing) |
| `machines` | `设置` (Settings) › `执行环境` (Execution) › `机器` (Machines) | [Machines](#machines) |
| `skills` | `设置` (Settings) › `执行环境` (Execution) › `技能` (Skills) | [Skills](#skills) |
| `mcp` | `设置` (Settings) › `执行环境` (Execution) › `MCP` | [MCP servers](#mcp-servers) |
| `secrets` | `设置` (Settings) › `安全` (Security) › `密钥` (Secrets) | [Secrets](#secrets) |
| `api-keys` | `设置` (Settings) › `安全` (Security) › `API 密钥` (API keys) | [API keys](#api-keys) |
| `remote` | `设置` (Settings) › `安全` (Security) › `远程访问` (Remote access) | [Remote access over the tailnet](#remote-access) |

## Features

### agent-computer

**The agent's computer** (partial, centrality 1). The Coordinator's own persistent computer and guarded access to the user's machine, with a live screen feed, desktop control, and a browser preference toggle in the web app.

States: No computer; command feed empty, streaming, or settled; live screen enlarged with control; browser enabled, disabled, unsupported (no capabilities.browser), preference retained while capability is gone, offline machine, and machine-mismatch when the chief computer is pinned elsewhere.

Reach:

1. `open /app`
2. `click testid:machines-button`
3. `click label:浏览器`
4. `click testid:machine-screen-expand`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `computer-command`, `computer-command-exit`, `computer-command-output`, `computer-command-text`, `computer-command-time`, `computer-control-bar`, `computer-feed`, `computer-feed-empty`, `computer-none`, `computer-state`, `machine-access`, `machine-detail-status`, `machine-edit`, `machine-folder`, `machine-folders-empty`, `machine-hostname`, `machine-list-row`, `machine-running-empty`, `machine-running-row`, `machine-screen`, `machine-screen-enlarged`, `machine-screen-expand`, `machine-screen-hint`, `machine-status-dot`, `machine-work`, `machines-add`, `machines-button`, `machines-recheck`
- Research: [docs/research/coordinator-computer.md](../../../docs/research/coordinator-computer.md) (not on main), [docs/research/agent-small-computer-2026-11-08.md](../../../docs/research/agent-small-computer-2026-11-08.md) (not on main), [docs/research/user-computer-model-2026-11-08.md](../../../docs/research/user-computer-model-2026-11-08.md) (not on main)
- Frontend design: **gap**: the computer feed, screen view, browser toggle and control handover have no design
- Backend design: **gap**: no design for computer access grants, the browser preference, the guard and the screen channel
- Evidence: `apps/web/e2e/machines-computer-feed.spec.ts`, `apps/web/test/machine-capabilities.test.ts`, `apps/server/test/computer-screen-routes.test.ts`, `apps/server/test/computer-feed-routes.test.ts`, `apps/daemon/test/computer-guard.test.ts`, `apps/daemon/test/computer-browser.test.ts`, `apps/daemon/test/machine-boot.test.ts`, `apps/daemon/test/orb-computer.test.ts`

### coordinator-chat

**Coordinator chat** (shipped, centrality 1). The one never-ending Coordinator conversation on the home page, where the user dispatches work and reads reports.

States: Empty home with starters, streaming reply with a stop control, finished reply with an action row and, when the Coordinator offered them, quick-reply chips above the composer, and a connection-lost banner when the stream drops.

Reach:

1. `open /app`
2. `click testid:chief-composer-block`
3. `type a request and press Enter`

- Web routes: `/app`
- Keyboard shortcuts in its code: `Enter`
- Test ids in its code: `chief-body`, `chief-bubble`, `chief-composer-block`, `chief-composer-error`, `chief-composer-input`, `chief-composer-placeholder`, `chief-digest`, `chief-digest-card`, `chief-digest-group`, `chief-digest-item`, `chief-earlier`, `chief-fallback-banner`, `chief-fallback-note`, `chief-gate`, `chief-handoff`, `chief-home-scroll`, `chief-msg`, `chief-msg-block-tools`, `chief-msg-col`, `chief-msg-copy`, `chief-msg-foot`, `chief-msg-more`, `chief-msg-reply`, `chief-msg-sending`, `chief-msg-stamp`, `chief-msg-steps`, `chief-msg-tools-touch`, `chief-note`, `chief-outage`, `chief-question`, `chief-question-asked`, `chief-question-chips`, `chief-question-dismiss`, `chief-question-error`, `chief-question-input-*`, `chief-question-line`, `chief-question-option-*`, `chief-question-submit`, `chief-question-text`, `chief-question-tools`, `chief-question-tools-touch`, `chief-quick-replies`, `chief-quick-reply`, `chief-reply`, `chief-reply-bubble`, `chief-report`, `chief-report-intake`, `chief-report-intake-item`, `chief-report-needs-you`, `chief-report-notice`, `chief-report-proposal`, `chief-report-retro`, `chief-report-yesterday`, `chief-routing-row`, `chief-sent-attachment`, `chief-sent-attachments`, `chief-settings-col`, `chief-settings-topbar`, `chief-status-live`, `chief-status-mark`, `chief-status-pill`, `chief-stopped`, `chief-stream`, `chief-task-created`, `chief-task-ref`, `chief-task-refs`, `chief-task-started`, `chief-time-divider`, `chief-turn-error`, `chief-turn-retry`, `composer-context-meter`, `composer-plus`, `composer-reply-bar`, `composer-reply-quote`, `composer-reply-quote-remove`, `connection-lost`, `home-c`, `home-c-error`, `home-c-hero`, `home-c-pane-buttons`, `home-c-since`, `home-c-starters`, `memory-list`, `panel-error`, `project-instructions-input`, `reply-quote`, `selection-reply`, `selection-reply-bar`, `tasks-badge`, `tasks-toggle`, `thread-activity`, `thread-activity-event`, `thread-activity-summary`, `thread-activity-toggle`, `thread-report-reply`
- Verify recipes: [.claude/skills/verify-cairn/features/chief-segments.md](features/chief-segments.md), [.claude/skills/verify-cairn/features/failed-send.md](features/failed-send.md)
- Research: [docs/research/coordinator-in-server.md](../../../docs/research/coordinator-in-server.md), [docs/research/dsh-sig-walk-2026-11.md](../../../docs/research/dsh-sig-walk-2026-11.md), [docs/research/pi-durable-spike.md](../../../docs/research/pi-durable-spike.md) (not on main), [docs/research/chat-markdown-polish-2026-11-08.md](../../../docs/research/chat-markdown-polish-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat), [docs/design/pilot-coordinator-chat-2026-11-06.md](../../../docs/design/pilot-coordinator-chat-2026-11-06.md) (not on main)
- Backend design: [docs/research/coordinator-in-server.md](../../../docs/research/coordinator-in-server.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](../../../docs/spec/26-pi-session-runtime-and-trust-surface.md), [docs/design/coordinator-quick-replies.md](../../../docs/design/coordinator-quick-replies.md)
- Evidence: `apps/web/e2e/chief-home-chat.spec.ts`, `apps/web/e2e/chief-home-c.spec.ts`, `apps/server/test/coordinator-turns.test.ts`, `apps/server/test/coordinator/turn.test.ts`

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
- Evidence: `integration/test/coordinator-context-assemble.test.ts`, `apps/server/test/chief-history.test.ts`, `apps/server/test/coordinator/compaction.test.ts`

### coordinator-dispatch

**Coordinator dispatch** (shipped, centrality 1). The Coordinator opens threads, picks the project, machine and model for each, and orchestrates splits; fixed role agents are retired.

States: The reply shows a handoff card and a thread activity row per dispatched thread, which updates as the thread runs and reports.

Reach:

1. `open /app`
2. `type a task for the Coordinator and press Enter`
3. `click testid:thread-activity-toggle`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/chief-dispatch-judgment.md](features/chief-dispatch-judgment.md)
- Research: [docs/research/cairn-dogfood-feasibility-2026-11-06.md](../../../docs/research/cairn-dogfood-feasibility-2026-11-06.md), [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md), [docs/research/r14-orchestration-parent-card.md](../../../docs/research/r14-orchestration-parent-card.md), [docs/research/r15-agent-responsibility-default.md](../../../docs/research/r15-agent-responsibility-default.md)
- Frontend design: n/a: dispatch shows as threads and report rows inside the Coordinator chat
- Backend design: [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md), [docs/research/r14-orchestration-parent-card.md](../../../docs/research/r14-orchestration-parent-card.md)
- Evidence: `apps/server/test/chief-dispatch.test.ts`, `integration/test/chief-dispatch-policy-binding.test.ts`, `apps/server/test/agent-removal.test.ts`

### daily-report

**Daily report and retro** (shipped, centrality 1). The Coordinator posts an 08:00 report in the conversation and proposes retro changes the user accepts or rejects.

States: A report row in the conversation with yesterday, needs-you and intake sections, and retro proposals that can be accepted or rejected.

Reach:

1. `open /app`
2. `click testid:chief-report`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-digest`, `chief-digest-card`, `chief-digest-group`, `chief-digest-item`, `chief-report`, `chief-report-intake`, `chief-report-intake-item`, `chief-report-needs-you`, `chief-report-notice`, `chief-report-proposal`, `chief-report-retro`, `chief-report-yesterday`
- Research: [docs/research/duet-proactive-coordinator.md](../../../docs/research/duet-proactive-coordinator.md)
- Frontend design: **gap**: the report row and retro proposal card have no design
- Backend design: **gap**: no design for report content, timing, quiet rules and retro proposal storage
- Evidence: `apps/web/e2e/chief-daily-report.spec.ts`, `apps/server/test/chief-report.test.ts`, `apps/server/test/chief-digest.test.ts`

### eval-gated-harness

**Eval-gated harness changes** (partial, centrality 1). A differentiator: a harness change is adopted only when a protected eval judges it better; trajectories export to traces for the self-improvement loop.

States: No product page; results appear as CI checks and command-line reports.

Reach:

1. `settings work-routing`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/eval-methods.md](../../../docs/research/eval-methods.md), [docs/research/trajectory-self-improvement-2026-11-08.md](../../../docs/research/trajectory-self-improvement-2026-11-08.md) (not on main)
- Frontend design: n/a: runs as CI checks and command-line tools with no product page
- Backend design: [docs/spec/29-evaluation-and-data-loop.md](../../../docs/spec/29-evaluation-and-data-loop.md), [docs/research/trajectory-self-improvement-2026-11-08.md](../../../docs/research/trajectory-self-improvement-2026-11-08.md) (not on main)
- Evidence: `apps/server/test/harness-eval-production.test.ts`, `apps/server/test/merge-gate-harness-eval.test.ts`, `apps/server/test/trajectory-export.test.ts`

### harness-dispatch

**Harness dispatch** (shipped, centrality 1). Each thread runs on a subscription CLI (Claude Code, Codex, pi) driven by the daemon, mostly through ACP, with the mode fixed at thread start.

States: No user page of its own; the thread transcript shows which harness and model ran each turn.

Reach:

1. `settings work-routing`
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

**Memory** (shipped, centrality 1). Team and project memories the Coordinator writes, consolidates, promotes and injects into later turns and threads. A design plans direct in-place edits of MEMORY.md and memory files.

States: Shipped: Coordinator settings, Memory tab, list team memory; each project settings page has a Memory tab with the project instructions and that project's memory. Core rows are read by every thread, searchable rows are memory files; a row opens a detail dialog with Delete. Planned replacement: input, working, applied, awaiting input, partial, stopped, error and offline; page and focused-file composers.

Reach:

1. `open /app`
2. `click label:Coordinator 设置`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-routing-row`, `chief-settings-col`, `chief-settings-topbar`, `memory-list`, `project-instructions-input`
- Research: [docs/research/personal-agent-memory-2026-11-07.md](../../../docs/research/personal-agent-memory-2026-11-07.md), [docs/research/research-loop-plan.md](../../../docs/research/research-loop-plan.md), [docs/research/memory-2026-11-08.md](../../../docs/research/memory-2026-11-08.md), [docs/research/memory-inplace-edit-2026-11-09.md](../../../docs/research/memory-inplace-edit-2026-11-09.md)
- Frontend design: [docs/design/memory-inplace-edit.md](../../../docs/design/memory-inplace-edit.md) (not on main)
- Backend design: [docs/design/memory-backend.md](../../../docs/design/memory-backend.md), [docs/design/memory-inplace-edit.md](../../../docs/design/memory-inplace-edit.md) (not on main)
- Evidence: `apps/web/e2e/chief-memory.spec.ts`, `apps/web/test/memory-list.test.ts`, `apps/server/test/memory-consolidation.test.ts`, `apps/server/test/project-memory.test.ts`, `integration/test/m4b-memory-e2e.test.ts`

### merge-gate

**Evidence-bound merge gate** (shipped, centrality 1). A differentiator: a merge lands only on the patch a verdict judged, with protected paths, required checks, review and the brake enforced by the server; per-project merge policy and ship route.

States: The gate shows why a merge is allowed or blocked; merge permission missing, merge in progress, merged.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:work-prs`
3. `click testid:accept-dialog-pr`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `accept-dialog-pr`
- Verify recipes: [.claude/skills/verify-cairn/features/review-700.md](features/review-700.md)
- Research: [docs/research/2513-tla-statecharts.md](../../../docs/research/2513-tla-statecharts.md), [docs/research/892-gate-usage-measurement.md](../../../docs/research/892-gate-usage-measurement.md), [docs/research/mergify-merge-queue-spike.md](../../../docs/research/mergify-merge-queue-spike.md), [docs/research/review-gate-alternatives.md](../../../docs/research/review-gate-alternatives.md) (not on main)
- Frontend design: **gap**: the gate verdict, merge button and merge-permission states in the thread have no design
- Backend design: [docs/research/2513-tla-statecharts.md](../../../docs/research/2513-tla-statecharts.md), [docs/spec/23-rework-to-original-branch-and-pr-convergence.md](../../../docs/spec/23-rework-to-original-branch-and-pr-convergence.md)
- Evidence: `apps/server/test/merge-gate-readiness.test.ts`, `apps/server/test/merge-gate-verdict-binding.test.ts`, `integration/test/gate-e2e.test.ts`

### needs-you

**Task references and needs-you** (shipped, centrality 1). A task the Coordinator creates or mentions shows as one reference row above the reply, tinted by its status, and opens the task panel; the Tasks toggle carries the needs-you count.

States: One reference row per task per reply (working, waiting, resolved, failed tint; unread dot); a lone row without a connector when the turn has no reply yet; a one-line link when the page no longer knows the task; no tray above the composer.

Reach:

1. `open /app`
2. `click testid:chief-task-ref`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-task-ref`
- Research: [docs/research/link-roundup-2026-11-01.md](../../../docs/research/link-roundup-2026-11-01.md), [docs/research/ui-ux-audit-2026-11-06.md](../../../docs/research/ui-ux-audit-2026-11-06.md) (not on main), [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md)
- Frontend design: [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md)
- Backend design: **gap**: no design for which records enter the tray, their order and when they leave
- Evidence: `apps/web/e2e/chief-home-needs-you.spec.ts`, `apps/web/e2e/chief-home-tray.spec.ts`, `apps/web/e2e/chief-home-task-cards.spec.ts`, `apps/server/test/needs-you.test.ts`

### orb-isolation

**Per-task orb isolation** (partial, centrality 1). A differentiator: each task runs in its own container orb on a swappable runtime, reached through the dispatch contract; opt-in today, default on capable machines next.

States: Off by default; when on, a thread runs in its own orb and the route override shows the orb choice.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:route-override-orb`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/amp-native-sandbox-orb.md](../../../docs/research/amp-native-sandbox-orb.md), [docs/research/user-computer-model-2026-11-08.md](../../../docs/research/user-computer-model-2026-11-08.md) (not on main)
- Frontend design: **gap**: nothing shows whether a thread ran in an orb or how to turn orbs on for a machine
- Backend design: [docs/research/orb-container-runtime.md](../../../docs/research/orb-container-runtime.md)
- Evidence: `apps/daemon/test/orb-runtime.test.ts`, `apps/daemon/test/orb-step.test.ts`, `apps/server/test/machine-orbs.test.ts`

### plans-and-review

**Plans, approval and review** (shipped, centrality 1). A thread's plan document with approval, timed auto-approve that can be paused, document diffs, and review that can reject work.

States: A plan waiting for approval with an auto-approve countdown that can be paused, approved, rejected with a request for changes, or compared against an earlier version.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click label:查看计划`
3. `click testid:doc-pane`

- Web routes: none
- Keyboard shortcuts in its code: `B`, `C`, `P`
- Test ids in its code: `diff-fold`, `diff-full`, `doc-body`, `doc-pane`
- Verify recipes: [.claude/skills/verify-cairn/features/review-modal.md](features/review-modal.md), [.claude/skills/verify-cairn/features/review-reject.md](features/review-reject.md)
- Research: [docs/research/m7-w5-ai-review-slice.md](../../../docs/research/m7-w5-ai-review-slice.md), [docs/research/892-gate-usage-measurement.md](../../../docs/research/892-gate-usage-measurement.md)
- Frontend design: **gap**: the plan pane, auto-approve countdown and reject flow have no current design
- Backend design: [docs/spec/08-m7-feature-closed-loop.md](../../../docs/spec/08-m7-feature-closed-loop.md)
- Evidence: `apps/web/e2e/spec-flow.spec.ts`, `apps/server/test/plan-server-auto-confirm.test.ts`, `apps/server/test/review-reject.test.ts`

### push-notifications

**Phone push** (shipped, centrality 1). Web push to the user's devices when something needs them, suppressed while they are looking at the thread.

States: Off, asking for permission, or on for this device; a notification opens the thread it names.

Reach:

1. `open /app`
2. `click testid:tasks-toggle`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: **gap**: no prior-art note on agent notifications and push delivery
- Frontend design: **gap**: the notify banner, device switch and push copy have no design
- Backend design: **gap**: no design for subscriptions, presence suppression, receipts and the three push states
- Evidence: `apps/web/e2e/push-device-switch.spec.ts`, `apps/web/e2e/notify-click.spec.ts`, `apps/server/test/push.test.ts`

### questions

**Question cards** (shipped, centrality 1). Questions from the Coordinator or a thread appear as answerable cards above the composer, stay parked quietly, and keep per-question drafts.

States: A question card sits above the composer with numbered options and a recommended one; it can be collapsed, answered later, or cancelled, and shows a line once answered.

Reach:

1. `open /app`
2. `click testid:chief-question-option-0-0`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-question`, `chief-question-chips`, `chief-question-error`, `chief-question-input-*`, `chief-question-option-*`, `chief-question-submit`, `chief-question-text`, `chief-question-tools`, `chief-question-tools-touch`
- Research: **gap**: the Codex CLI and t3code question patterns were never written up
- Frontend design: [docs/design/qcard-variants/README.md](../../../docs/design/qcard-variants/README.md) (not on main), [docs/design/pilot-coordinator-chat-2026-11-06.md](../../../docs/design/pilot-coordinator-chat-2026-11-06.md) (not on main)
- Backend design: **gap**: no design for the question lifecycle: parking, late answers, cancel and resume
- Evidence: `apps/web/e2e/chief-home-questions.spec.ts`, `apps/server/test/chief-questions.test.ts`, `apps/web/test/question-lifecycle.test.ts`

### routing

**Model and work routing** (shipped, centrality 1). Which model and machine each kind of work uses: model routing, work routing rules and policies, capabilities and a per-thread override.

States: A routing graph from kinds of work to models, an empty state, rules per use, and a per-thread override dialog.

Reach:

1. `settings routing`
2. `click testid:routing-section`
3. `settings work-routing`

- Web routes: `/app/resources/model-routing`, `/app/resources/routing-settings`, `/app/settings/team`, `/app/team`
- Settings: `设置` (Settings) › `模型` (Model) › `用量与连接` (Usage & connections); `设置` (Settings) › `模型` (Model) › `规则与策略` (Rules & policies)
- Keyboard shortcuts in its code: none
- Test ids in its code: `claude-usage-hint`, `route-override-dialog`, `route-override-machine`, `route-override-mcp-*`, `route-override-orb`, `route-override-save`, `routing-empty`, `routing-rule-*`, `routing-rule-new-*`, `routing-section`, `routing-settings-empty`, `settings-scope-note`, `work-policy-*`
- Research: [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md), [docs/research/agent-machine-routing.md](../../../docs/research/agent-machine-routing.md) (not on main)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: [docs/research/capability-routing-2026-11-06.md](../../../docs/research/capability-routing-2026-11-06.md)
- Evidence: `apps/web/e2e/settings-routing.spec.ts`, `apps/web/e2e/route-override-capabilities.spec.ts`, `apps/server/test/routing-rules.test.ts`

### selection-reply

**Selection reply** (shipped, centrality 1). Select text in a Coordinator message and press Reply to quote it above the composer; the sent message carries the quote and its source message id.

States: Bar above the selection, quote staged above the composer, sent bubble with the quote, no bar on touch selections, light and dark, 1440 and 390 wide.

Reach:

1. `open /app`
2. `type select two or more characters inside one Coordinator reply`
3. `click testid:selection-reply`

- Web routes: `/app`
- Keyboard shortcuts in its code: `Enter`
- Test ids in its code: `composer-reply-bar`, `composer-reply-quote`, `composer-reply-quote-remove`, `reply-quote`, `selection-reply`, `selection-reply-bar`
- Research: [docs/research/selection-reply-2026-11-08.md](../../../docs/research/selection-reply-2026-11-08.md)
- Frontend design: [docs/design/selection-reply-2026-11-08.md](../../../docs/design/selection-reply-2026-11-08.md)
- Backend design: [docs/design/selection-reply-2026-11-08.md](../../../docs/design/selection-reply-2026-11-08.md)
- Evidence: `apps/web/e2e/chief-selection-reply.spec.ts`, `packages/shared/test/reply-quote.test.ts`, `apps/web/test/selection-reply-model.test.ts`

### steer-queue-stop

**Steer, queue and stop** (shipped, centrality 1). The user can steer a running thread, queue messages behind it, stop it, or stop and mark it done.

States: While a thread runs, new messages queue as capsules or steer the current turn; stop asks for confirmation and the thread shows a stopped row.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:composer-card`
3. `type a follow-up while the thread runs`
4. `click label:停止`

- Web routes: none
- Keyboard shortcuts in its code: none
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
2. `click testid:machine-running`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/machine-execution-plane.md](../../../docs/research/machine-execution-plane.md), [docs/research/r13-multica-runtime-verify.md](../../../docs/research/r13-multica-runtime-verify.md)
- Frontend design: n/a: a protocol between server and daemon with no user surface
- Backend design: [docs/research/2513-tla-statecharts.md](../../../docs/research/2513-tla-statecharts.md)
- Evidence: `apps/server/test/machine-pool-claim.test.ts`, `apps/server/test/machine-zombie-claim.test.ts`, `apps/daemon/test/machine-claim.test.ts`

### thread-pr-panel

**Thread PR panel and auto-fix** (shipped, centrality 1). The thread that opens a PR owns it until merge: the PR panel with changes and checks, branch sync, and wakes on CI, conflicts and review comments.

States: No PR yet, open with checks running or failing, conflicts, merged, or a load error; changes open file by file.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:work-prs`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `thread-pr-error`, `thread-pr-panel`
- Verify recipes: [.claude/skills/verify-cairn/features/branch-sync.md](features/branch-sync.md)
- Research: [docs/research/thread-pr-placement-2026-11-06.md](../../../docs/research/thread-pr-placement-2026-11-06.md) (not on main), [docs/research/review-findings-before-ready-2026-11-07.md](../../../docs/research/review-findings-before-ready-2026-11-07.md)
- Frontend design: [docs/design/references/thread-review](../../../docs/design/references/thread-review)
- Backend design: [docs/research/thread-pr-autofix.md](../../../docs/research/thread-pr-autofix.md)
- Evidence: `apps/web/e2e/thread-pr-panel.spec.ts`, `apps/web/test/pr-panel-model.test.ts`, `apps/server/test/thread-pr.test.ts`, `apps/server/test/pr-wakes.test.ts`

### thread-transcript

**Thread transcript and work trace** (shipped, centrality 1). The live transcript of a thread's run: messages, tool rows, thinking, steps and usage in the side panel.

States: Messages stream in with tool and thinking rows; finished, cancelled and unfinished work blocks; usage shows in the footer.

Reach:

1. `open /app/todo/<id of a thread listed by the todos API>`
2. `click testid:side-chat`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `agent-text`, `agent-todo`, `automation-completed`, `edit-error`, `fail-raw-error`, `home-c`, `info-report`, `left`, `live-row`, `made-archived-empty`, `made-archived-note`, `made-empty`, `made-group`, `made-group-count`, `made-no-match`, `made-search-toggle`, `made-tabs`, `msg-actions`, `msg-stamp`, `msg-tools`, `msg-tools-touch`, `queued-capsules-standalone`, `right`, `schedule-wake-marker`, `scheduled-turn`, `side-chat`, `side-chat-back`, `side-chat-changes`, `side-chat-changes-view`, `side-chat-panel`, `side-chat-plan`, `side-chat-send-error`, `side-chat-status`, `side-chat-unavailable`, `skill-line`, `skills-summary`, `step-prompt-raw`, `thinking-body`, `tool-output`, `transcript-note`, `transcript-question`, `transcript-step-prompt`, `transcript-time-divider`, `user-bubble`, `verify-evidence`, `work-block`, `work-call`, `work-cancelled`, `work-spinner`, `work-summary`, `work-think`, `work-unfinished`
- Verify recipes: [.claude/skills/verify-cairn/features/detail-right-pane.md](features/detail-right-pane.md)
- Research: [docs/research/r15-multica-run-rendering.md](../../../docs/research/r15-multica-run-rendering.md), [docs/research/chat-markdown-polish-2026-11-08.md](../../../docs/research/chat-markdown-polish-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/thread-review](../../../docs/design/references/thread-review)
- Backend design: [docs/spec/17-dual-runtime-execution-surface.md](../../../docs/spec/17-dual-runtime-execution-surface.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](../../../docs/spec/26-pi-session-runtime-and-trust-surface.md)
- Evidence: `apps/web/e2e/detail-work-trace.spec.ts`, `apps/web/e2e/chief-home-side-chat.spec.ts`, `apps/web/test/work-trace-mapper.test.ts`, `apps/server/test/conv-stream-catchup.test.ts`

### threads

**Threads** (shipped, centrality 1). A thread is one piece of work with its own session: created, continued, snoozed, archived, reset and counted by phase.

States: Running, waiting on the user, done, snoozed or archived; the thread opens in the side panel with its actions menu. Tasks reads include recent archives and pending standalone Coordinator questions; section is derived on every read.

Reach:

1. `open /app`
2. `click testid:tasks-toggle`
3. `click testid:tasks-section`
4. `click testid:side-chat-action`

- Web routes: `/app/todo/:id`
- Keyboard shortcuts in its code: `B`, `C`, `P`
- Test ids in its code: `accept-dialog-pr`, `agent-text`, `agent-todo`, `automation-completed`, `chief-reply-bubble`, `composer-card`, `composer-placeholder`, `composer-plus`, `composer-toolbar`, `diff-fold`, `diff-full`, `doc-body`, `doc-pane`, `edit-error`, `fail-raw-error`, `info-report`, `left`, `live-row`, `md-checkbox`, `md-code`, `md-code-block`, `md-code-copy`, `md-code-dialog-body`, `md-code-dialog-copy`, `md-code-done`, `md-code-expand`, `md-code-lang`, `md-item-bullet`, `md-item-ordered`, `md-item-task`, `md-list-bullet`, `md-list-ordered`, `md-list-task`, `md-quote`, `md-table`, `md-task`, `md-task-children`, `md-tasks`, `msg-actions`, `msg-stamp`, `msg-tools`, `msg-tools-touch`, `right`, `schedule-wake-marker`, `scheduled-turn`, `side-chat-action`, `skill-line`, `skills-summary`, `source-issue-drift`, `source-issue-echo`, `source-issue-pending`, `source-issue-retry`, `source-orchestration`, `source-orchestration-link`, `step-prompt-raw`, `thinking-body`, `tool-output`, `transcript-col`, `transcript-note`, `transcript-question`, `transcript-step-prompt`, `transcript-time-divider`, `user-bubble`, `verify-evidence`, `work-block`, `work-call`, `work-cancelled`, `work-spinner`, `work-summary`, `work-think`, `work-unfinished`
- Verify recipes: [.claude/skills/verify-cairn/features/board-new-task.md](features/board-new-task.md), [.claude/skills/verify-cairn/features/agent-detail.md](features/agent-detail.md)
- Research: [docs/research/r12-save-and-start-behavior.md](../../../docs/research/r12-save-and-start-behavior.md), [docs/research/r14-orchestration-parent-card.md](../../../docs/research/r14-orchestration-parent-card.md), [docs/research/branch-model-2026-11-08.md](../../../docs/research/branch-model-2026-11-08.md) (not on main), [docs/research/duet-proactive-coordinator.md](../../../docs/research/duet-proactive-coordinator.md)
- Frontend design: [docs/design/references/thread-review](../../../docs/design/references/thread-review), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md)
- Backend design: [docs/spec/23-rework-to-original-branch-and-pr-convergence.md](../../../docs/spec/23-rework-to-original-branch-and-pr-convergence.md), [docs/design/runtime-memory-out-of-tree.md](../../../docs/design/runtime-memory-out-of-tree.md), [docs/research/branch-model-2026-11-08.md](../../../docs/research/branch-model-2026-11-08.md) (not on main), [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md)
- Evidence: `apps/web/e2e/detail-continue-thread.spec.ts`, `apps/web/e2e/detail-archive.spec.ts`, `apps/server/test/snooze.test.ts`, `apps/server/test/archive.test.ts`, `apps/server/test/tasks.test.ts`

### desktop-app

**Desktop app** (planned, centrality 2). A web shell that bundles the server, daemon, Coordinator and tsnet, so installing it makes the machine an executor.


- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/desktop-app-stack-2026-11-08.md](../../../docs/research/desktop-app-stack-2026-11-08.md) (not on main)
- Frontend design: **gap**: no design for the tray, window and install flow
- Backend design: **gap**: no design for packaging, process supervision, updates and data location
- Evidence: none

### first-run

**First run** (shipped, centrality 2). The home checklist, connection banners and the first-PR card that take a new user to a first merged PR.

States: A checklist on the home page until a machine, a model and a project are set, a setup hint on the composer, then a first-PR card.

Reach:

1. `open /app`
2. `click testid:composer-setup-chip`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `composer-setup-chip`, `composer-setup-hint`
- Research: [docs/research/ui-ux-audit-2026-11-06.md](../../../docs/research/ui-ux-audit-2026-11-06.md) (not on main)
- Frontend design: [docs/design/references/first-run](../../../docs/design/references/first-run)
- Backend design: **gap**: no design for checklist state, first-PR detection and the 10-minute path
- Evidence: `apps/web/e2e/first-run-checklist.spec.ts`, `apps/web/e2e/first-pr-report.spec.ts`, `apps/server/test/first-pr-report.test.ts`

### machine-enrollment

**Machine enrollment** (shipped, centrality 2). Adding a machine: the daemon starts an enrollment, the user approves it on the authorize page in the browser.

States: A request waiting for approval, approved, expired or denied; the machine then appears in the list.

Reach:

1. `open /app/machines/authorize`

- Web routes: `/app/machines/authorize`
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/machine-execution-plane.md](../../../docs/research/machine-execution-plane.md)
- Frontend design: **gap**: the add-machine dialog and authorize page have no design
- Backend design: **gap**: no design for the browser enrollment handshake and its failure modes
- Evidence: `apps/web/e2e/machine-authorize.spec.ts`, `apps/server/test/enroll-browser.test.ts`, `apps/daemon/test/machine-enroll.test.ts`

### machines

**Machines** (shipped, centrality 2). The machines page and machine detail: online state, capabilities, concurrency, revoke and evacuate.

States: An empty state, online and offline machines with last seen, a machine detail with runtimes, capabilities and concurrency.

Reach:

1. `settings machines`
2. `click testid:machine-item`
3. `click testid:machine-concurrency-inc`

- Web routes: `/app/resources/machines`, `/app/resources/machines/:id`
- Settings: `设置` (Settings) › `执行环境` (Execution) › `机器` (Machines)
- Keyboard shortcuts in its code: none
- Test ids in its code: `machine-list`, `machines-scroll`, `resource-empty`
- Verify recipes: [.claude/skills/verify-cairn/features/machines-local-row.md](features/machines-local-row.md), [.claude/skills/verify-cairn/features/machine-concurrency.md](features/machine-concurrency.md)
- Research: [docs/research/machine-execution-plane.md](../../../docs/research/machine-execution-plane.md), [docs/research/t3code-devices-and-scope-2026-11-06.md](../../../docs/research/t3code-devices-and-scope-2026-11-06.md) (not on main)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings), [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md)
- Backend design: [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md)
- Evidence: `apps/web/e2e/machine-detail.spec.ts`, `apps/web/e2e/machines-local.spec.ts`, `apps/server/test/machine-revoke.test.ts`

### mobile-web

**Mobile web and PWA** (shipped, centrality 2). The web app installed on a phone: narrow layouts, the service worker and the home-screen app.

States: At phone width the Coordinator home has no header bar: a round menu button, the bare status mark and one round Tasks button with its count badge float at the top, a floating pill tab bar switches chat, Tasks and results with a round computers button beside it, every side panel is a full-screen tab between them, the composer is one row, settings and activity live in the drawer footer, touch message tools appear on a tap, and the sidebar drawer pushes the conversation back as a dimmed card; settings collapse to a list; the app can be installed to the home screen.

Reach:

1. `open /app`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `narrow-menu`, `tasks-badge`, `tasks-toggle`
- Research: **gap**: no note on how Amp, t3code and Claude handle mobile web and PWA install
- Frontend design: [docs/design/duet-shaped-clients.md](../../../docs/design/duet-shaped-clients.md), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md)
- Backend design: n/a: served by the same server; push is its own feature
- Evidence: `apps/web/e2e/mobile-narrow.spec.ts`, `apps/web/e2e/chief-home-phone-tabs.spec.ts`, `apps/web/e2e/chief-home-narrow-shell.spec.ts`, `apps/web/test/pwa.test.ts`

### own-key-sandboxes

**Own-key cloud sandboxes** (partial, centrality 2). Execution target: orbs on E2B or Daytona with the user's own key, called outbound by the daemon.

States: Not exposed in the UI yet; the daemon selects E2B when configured.

Reach:

1. `settings machines`
2. `click testid:machine-list`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: **gap**: no note comparing E2B and Daytona against the dispatch contract
- Frontend design: **gap**: no design for adding a sandbox provider and its key
- Backend design: **gap**: no design for the E2B and Daytona providers, key injection and teardown
- Evidence: `apps/daemon/test/orb-e2b.test.ts`, `apps/daemon/test/orb-e2b-client.test.ts`

### providers

**Model providers and subscriptions** (shipped, centrality 2). The user connects their own provider keys, OAuth presets and Claude or Codex subscriptions; cairn lists live models per source.

States: An empty list, providers with their models, a subscription being verified, verified or failing with a reason.

Reach:

1. `settings providers`
2. `click testid:resource-new`
3. `click testid:subscription-verify`

- Web routes: `/app/resources/providers`
- Settings: `设置` (Settings) › `模型` (Model) › `模型服务` (Providers)
- Keyboard shortcuts in its code: none
- Test ids in its code: `providers-empty`, `providers-partial-error`, `resource-new`, `subscription-label`, `subscription-token`
- Verify recipes: [.claude/skills/verify-cairn/features/providers-tabs.md](features/providers-tabs.md), [.claude/skills/verify-cairn/features/provider-picker.md](features/provider-picker.md)
- Research: [docs/research/r16-model-catalog-liveness.md](../../../docs/research/r16-model-catalog-liveness.md), [docs/research/2330-claude-entrypoint-and-setup-token-quota.md](../../../docs/research/2330-claude-entrypoint-and-setup-token-quota.md)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings), [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md)
- Backend design: [docs/spec/11-model-service-and-machine-localization.md](../../../docs/spec/11-model-service-and-machine-localization.md), [docs/research/r16-model-catalog-liveness.md](../../../docs/research/r16-model-catalog-liveness.md)
- Evidence: `apps/web/e2e/providers-claude-subscription.spec.ts`, `apps/web/e2e/provider-add-dialog.spec.ts`, `apps/server/test/claude-subscriptions.test.ts`

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
- Test ids in its code: `pair-new-device`, `pairing-blocked`, `pairing-route-select`, `remote-routes-empty`
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
- Test ids in its code: none
- Research: [docs/research/seamless-device-auth-2026-11-08.md](../../../docs/research/seamless-device-auth-2026-11-08.md) (not on main)
- Frontend design: **gap**: the sign-in gate and the signed-in-by-tailnet state have no design
- Backend design: [docs/research/seamless-device-auth-2026-11-08.md](../../../docs/research/seamless-device-auth-2026-11-08.md) (not on main)
- Evidence: `apps/web/e2e/token-gate.spec.ts`, `apps/server/test/token-auth.test.ts`, `apps/server/test/tailnet-listener.test.ts`

### account-and-team

**Account and team** (shipped, centrality 3). The user's account, the team record and the PR attribution settings.

States: Account details and language, and the PR attribution settings.

Reach:

1. `settings account`

- Web routes: `/app/account`
- Settings: `设置` (Settings) › `账号` (Account)
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/avatars.md](features/avatars.md)
- Research: [docs/research/bot-identity-and-coauthorship-2026-11-07.md](../../../docs/research/bot-identity-and-coauthorship-2026-11-07.md)
- Frontend design: [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: **gap**: no design for the single-user account, the team record and attribution settings
- Evidence: `apps/web/e2e/account-controls.spec.ts`, `apps/web/e2e/team-attribution-settings.spec.ts`, `apps/server/test/user-patch.test.ts`

### api-keys

**API keys** (shipped, centrality 3). API keys with grants for scripts and external harnesses.

States: An empty state, a list of keys, and a create dialog with grants; the key is shown once.

Reach:

1. `settings api-keys`
2. `click testid:keys-empty`

- Web routes: `/app/api-keys`
- Settings: `设置` (Settings) › `安全` (Security) › `API 密钥` (API keys)
- Keyboard shortcuts in its code: none
- Test ids in its code: `keys-empty`
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
- Test ids in its code: `archived-project-unarchive`, `archived-projects-empty`, `settings-backdrop`, `settings-body`, `settings-content`, `settings-head`, `settings-title`
- Verify recipes: [.claude/skills/verify-cairn/features/hotkeys.md](features/hotkeys.md), [.claude/skills/verify-cairn/features/persona-verify.md](features/persona-verify.md)
- Research: [docs/research/ai-frontend-quality-2026-11-06.md](../../../docs/research/ai-frontend-quality-2026-11-06.md) (not on main), [docs/research/ui-ux-audit-2026-11-06.md](../../../docs/research/ui-ux-audit-2026-11-06.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/settings](../../../docs/design/references/settings)
- Backend design: n/a: static serving, a server-sent event stream and two no-op analytics sinks (see docs/privacy.md)
- Evidence: `apps/web/e2e/settings-master-detail.spec.ts`, `apps/web/e2e/shell-consistency.spec.ts`, `apps/server/test/sse.test.ts`

### appearance

**Appearance and visual system** (shipped, centrality 3). Theme, type and the visual language every page follows.

States: Light, dark or system theme, applied immediately.

Reach:

1. `settings appearance`

- Web routes: none
- Settings: `设置` (Settings) › `外观` (Appearance)
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/theme.md](features/theme.md)
- Research: [docs/research/ai-frontend-quality-2026-11-06.md](../../../docs/research/ai-frontend-quality-2026-11-06.md) (not on main), [docs/research/serif-typography-2026-11-08.md](../../../docs/research/serif-typography-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/settings](../../../docs/design/references/settings), [docs/spec/base-ui-theme.md](../../../docs/spec/base-ui-theme.md)
- Backend design: n/a: a client setting with no server state
- Evidence: `apps/web/e2e/theme-toggle.spec.ts`, `apps/web/test/anti-slop-foundations.test.ts`

### attachments

**Attachments** (shipped, centrality 3). Files dropped, pasted or picked into a composer and files agents attach to threads, uploaded by grant and reclaimed later; a sent attachment is a card above the user's message that opens in the right-hand file preview panel.

States: Composer tile uploading (grey pulse), ready, failed (removable) and the drop-target outline; sent attachment card; file preview panel for text with line numbers, an empty file, an image, an unsupported type, loading and a load error; agent attachments in the thread transcript.

Reach:

1. `open /app`
2. `click testid:chief-sent-attachment`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `attachment-pending`, `chief-sent-attachment`, `chief-sent-attachments`, `composer-attachments`, `file-preview-broken`, `file-preview-copy`, `file-preview-download`, `file-preview-image`, `file-preview-markdown`, `file-preview-name`, `file-preview-panel`, `file-preview-pdf`, `file-preview-source-toggle`, `file-preview-text`, `file-preview-truncated`, `file-preview-unsupported`
- Verify recipes: [.claude/skills/verify-cairn/features/attachments.md](features/attachments.md)
- Research: [docs/research/file-preview-reference-2026-11-11.md](../../../docs/research/file-preview-reference-2026-11-11.md)
- Frontend design: [docs/design/references/coordinator-chat/claude-duet-composer-attachment.jpg](../../../docs/design/references/coordinator-chat/claude-duet-composer-attachment.jpg), [docs/design/references/coordinator-chat/claude-duet-file-preview-panel.jpg](../../../docs/design/references/coordinator-chat/claude-duet-file-preview-panel.jpg), [docs/design/references/coordinator-chat/claude-duet-sent-attachment-uploading.jpg](../../../docs/design/references/coordinator-chat/claude-duet-sent-attachment-uploading.jpg)
- Backend design: [docs/spec/20-attachment-reclaim-strategy.md](../../../docs/spec/20-attachment-reclaim-strategy.md), [docs/design/side-panels-backend-gaps.md](../../../docs/design/side-panels-backend-gaps.md)
- Evidence: `apps/web/e2e/attachment-strip.spec.ts`, `apps/web/e2e/chief-files.spec.ts`, `apps/web/e2e/detail-agent-attachments.spec.ts`, `apps/server/test/attachments.test.ts`

### composer

**Composer** (shipped, centrality 3). The message composer: mentions, slash commands, named prompts and drafts that survive closing the app.

States: Empty with a placeholder, a draft restored after reload, slash menu and mention suggestions open, and a send error.

Reach:

1. `open /app`
2. `click testid:chief-composer-block`
3. `type / to open slash commands or @ to mention`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `chief-composer-input`, `chief-composer-placeholder`, `composer-plus`
- Verify recipes: [.claude/skills/verify-cairn/features/mentions.md](features/mentions.md), [.claude/skills/verify-cairn/features/failed-send.md](features/failed-send.md), [.claude/skills/verify-cairn/features/hotkeys.md](features/hotkeys.md)
- Research: **gap**: no note comparing composers in claude.ai, Amp and t3code
- Frontend design: [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat)
- Backend design: **gap**: no design for server drafts  and named prompts
- Evidence: `apps/web/e2e/composer-slash.spec.ts`, `apps/web/e2e/chief-draft-persist.spec.ts`, `apps/server/test/composer-drafts.test.ts`

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

**GitHub connection and issues** (shipped, centrality 3). Connecting GitHub, choosing repositories, importing issues as threads and writing results back to the issue.

States: Not connected, connected with a repository picker, an issue imported as a thread, and the write-back pending, done, drifted or failed with retry.

Reach:

1. `open /app/project/<id of a project listed by the projects API>`
2. `click testid:project-home-links`
3. `open /app/todo/<id of a thread listed by the todos API>`
4. `click testid:source-issue-retry`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `source-issue-drift`, `source-issue-echo`, `source-issue-pending`, `source-issue-retry`, `source-orchestration`, `source-orchestration-link`
- Verify recipes: [.claude/skills/verify-cairn/features/github-oauth-picker.md](features/github-oauth-picker.md), [.claude/skills/verify-cairn/features/github-emulator.md](features/github-emulator.md)
- Research: [docs/research/bot-identity-and-coauthorship-2026-11-07.md](../../../docs/research/bot-identity-and-coauthorship-2026-11-07.md)
- Frontend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Backend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Evidence: `apps/web/e2e/project-github-issues.spec.ts`, `apps/web/e2e/github-issue-writeback.spec.ts`, `apps/server/test/github-connection.test.ts`

### harness-profile

**Harness profile** (partial, centrality 3). Spec 30: an opt-in, secret-free profile that keeps harness configuration the same across machines; default off.

States: Off by default with no UI; spec 30 plans a settings section.

Reach:

1. `settings machines`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: [docs/research/t3code-devices-and-scope-2026-11-06.md](../../../docs/research/t3code-devices-and-scope-2026-11-06.md) (not on main)
- Frontend design: **gap**: the settings section planned in plan §22.7 is not in the repository
- Backend design: [docs/spec/30-harness-profile-opt-in.md](../../../docs/spec/30-harness-profile-opt-in.md)
- Evidence: `apps/server/test/harness-profile-default-off.test.ts`

### mcp-servers

**MCP servers** (shipped, centrality 3). The read-only list of MCP servers configured on each machine.

States: An empty state or a read-only list of servers per machine.

Reach:

1. `settings mcp`
2. `click testid:resource-row`

- Web routes: `/app/resources/mcp-servers`
- Settings: `设置` (Settings) › `执行环境` (Execution) › `MCP`
- Keyboard shortcuts in its code: none
- Test ids in its code: `resource-empty`
- Verify recipes: [.claude/skills/verify-cairn/features/mcp-servers.md](features/mcp-servers.md)
- Research: **gap**: no note on MCP configuration surfaces in t3code and Amp
- Frontend design: [docs/spec/13-resources-view-localization.md](../../../docs/spec/13-resources-view-localization.md)
- Backend design: [docs/spec/13-resources-view-localization.md](../../../docs/spec/13-resources-view-localization.md)
- Evidence: `apps/server/test/mcp-servers.test.ts`, `apps/daemon/test/mcp-config.test.ts`

### projects

**Projects** (shipped, centrality 3). Projects as filter and context: create from a local repo or GitHub, project home, settings (base branch, concurrency, autonomy, instructions, local path), archive, unarchive from Settings or the sidebar's archived filter, an archived project opened read-only, and delete.

States: A new-project form for a local folder or a GitHub repository, a project home, settings for base branch, concurrency, autonomy and instructions, archived or deleted.

Reach:

1. `open /app/project/new`
2. `click testid:github-picker`
3. `open /app/project/<id of a project listed by the projects API>/tasks`
4. `open /app/project/<id of a project listed by the projects API>/settings`
5. `click testid:project-instructions-input`
6. `settings projects`

- Web routes: `/app/project/:id`, `/app/project/:id/settings`, `/app/project/:id/tasks`, `/app/project/new`
- Settings: `设置` (Settings) › `项目`
- Keyboard shortcuts in its code: `A`, `D`, `G`, `L`, `P`, `R`, `T`
- Test ids in its code: `archived-project-unarchive`, `archived-projects-empty`, `github-picker`, `project-home`, `project-home-ask`, `project-home-edit-blocked`, `project-home-empty`, `project-home-instructions`, `project-home-links`, `task-card`, `task-meta`, `task-row`, `task-status`
- Verify recipes: [.claude/skills/verify-cairn/features/project-new-form.md](features/project-new-form.md), [.claude/skills/verify-cairn/features/github-oauth-picker.md](features/github-oauth-picker.md), [.claude/skills/verify-cairn/features/local-repo-api.md](features/local-repo-api.md)
- Research: [docs/research/project-coordinators.md](../../../docs/research/project-coordinators.md) (not on main), [docs/research/project-files-retirement-2026-11-09.md](../../../docs/research/project-files-retirement-2026-11-09.md), [docs/research/archived-projects-entry-2026-11-09.md](../../../docs/research/archived-projects-entry-2026-11-09.md)
- Frontend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/archived-projects-settings.md](../../../docs/design/archived-projects-settings.md)
- Backend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](../../../docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Evidence: `apps/web/e2e/project-new-repo.spec.ts`, `apps/web/e2e/project-settings-autonomy.spec.ts`, `apps/server/test/project-delete.test.ts`, `apps/web/e2e/settings-archived-projects.spec.ts`

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
- Evidence: `apps/server/test/research-trigger.test.ts`, `apps/server/test/research-before-plan.test.ts`, `apps/daemon/test/web-search.test.ts`

### schedules

**Scheduled tasks** (shipped, centrality 3). Recurring work that starts or continues threads on a schedule, with run-now and a project schedule.

States: Loading, empty, a list of schedules with cadence, a detail dialog with run now, and an error state.

Reach:

1. `open /app/schedules`
2. `click testid:schedule-detail-body`

- Web routes: `/app/schedules`
- Keyboard shortcuts in its code: `D`
- Test ids in its code: `schedule-detail-body`, `schedules-error`, `schedules-loading`
- Research: **gap**: no note on Claude Code scheduled tasks, Amp and the Durable Objects alarm model
- Frontend design: **gap**: the schedules page and detail dialog have no design
- Backend design: **gap**: no design for due events, missed runs and continue-thread schedules
- Evidence: `apps/web/e2e/schedules-live.spec.ts`, `apps/server/test/schedules.test.ts`, `apps/server/test/due-events.test.ts`

### search-and-activity

**Search and activity** (shipped, centrality 3). The search palette with its query syntax and the activity page over all threads.

States: The search palette with syntax help and query chips, and the activity list grouped by day with filters, totals and load more.

Reach:

1. `open /app`
2. `press Mod+K`
3. `open /app/activity`
4. `click testid:quick-filter`

- Web routes: `/app/activity`
- Keyboard shortcuts in its code: `Mod+K`
- Test ids in its code: `activity-empty`, `activity-error`, `activity-group`, `activity-group-total`, `activity-list`, `activity-load-more`, `activity-row-cost`, `activity-showing`, `activity-summary`, `chip-problems`, `query-chip`, `quick-filter`, `search-context`, `search-error`, `syntax-help`
- Verify recipes: [.claude/skills/verify-cairn/features/search.md](features/search.md)
- Research: **gap**: no note on Amp's search syntax and activity filters
- Frontend design: [docs/design/references/thread-list-sidebar](../../../docs/design/references/thread-list-sidebar), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md)
- Backend design: **gap**: no design for the search syntax, index and ranking
- Evidence: `apps/web/e2e/activity-page.spec.ts`, `apps/web/e2e/search-syntax-palette.spec.ts`, `apps/server/test/search-syntax.test.ts`

### secrets

**Secrets** (shipped, centrality 3). Team and project secrets stored encrypted and delivered to threads that need them.

States: An empty list, secrets by scope, and an add dialog with team or project scope.

Reach:

1. `settings secrets`
2. `click testid:resource-new`
3. `click testid:secret-scope`

- Web routes: `/app/resources/secrets`
- Settings: `设置` (Settings) › `安全` (Security) › `密钥` (Secrets)
- Keyboard shortcuts in its code: none
- Test ids in its code: `resource-empty`, `secret-scope`
- Research: [docs/research/1775-gateway-prior-art.md](../../../docs/research/1775-gateway-prior-art.md)
- Frontend design: **gap**: the secrets page and project secrets have no design
- Backend design: [docs/research/1775-secret-gateway-design.md](../../../docs/research/1775-secret-gateway-design.md)
- Evidence: `apps/web/e2e/secret-add-dialog.spec.ts`, `apps/web/e2e/project-secrets.spec.ts`, `apps/server/test/project-secrets.test.ts`

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

**Sidebar** (shipped, centrality 3). The sidebar tree: the Coordinator row with its projects hung under it on a tree guide, owner-made project groups as folder rows, a needs-you dot, the project menu (rename, instructions, move to group, archive, delete), the group menu, the project filter (active, archived, all) with the archived row menu (unarchive, delete) and the machine-status footer.

States: Projects under the Coordinator with no group, ungrouped projects then groups in name order, a folded group with its count, an ochre dot on a project with a task waiting on the owner, the open row menu, loading or error rows, the filter on archived (note, archived rows with their groups, back row) or empty archived, the filter on all with archived rows marked, an archived project opened read-only with the unarchive bar, and the 48px rail.

Reach:

1. `open /app`
2. `click testid:project-group-header`
3. `click testid:sidebar-project-filter`
4. `click testid:sidebar-project-filter-archived`
5. `click testid:archived-project-bar-unarchive`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: `archived-project-bar`, `archived-project-bar-unarchive`, `project-group-header`, `sidebar-activity`, `sidebar-archived-delete-all`, `sidebar-archived-empty`, `sidebar-archived-note`, `sidebar-archived-page`, `sidebar-attention`, `sidebar-footer`, `sidebar-pinned`, `sidebar-project-filter`, `sidebar-project-filter-*`, `sidebar-projects-error`, `sidebar-projects-loading`, `sidebar-reopen`, `sidebar-settings`, `team-row`
- Research: [docs/research/sidebar-coordinator-icon-2026-11-08.md](../../../docs/research/sidebar-coordinator-icon-2026-11-08.md) (not on main), [docs/research/archived-projects-entry-2026-11-09.md](../../../docs/research/archived-projects-entry-2026-11-09.md)
- Frontend design: [docs/design/references/thread-list-sidebar](../../../docs/design/references/thread-list-sidebar), [docs/design/references/coordinator-chat](../../../docs/design/references/coordinator-chat), [docs/design/claude-ai-spec.md](../../../docs/design/claude-ai-spec.md), [docs/design/archived-projects-settings.md](../../../docs/design/archived-projects-settings.md)
- Backend design: **gap**: no design for unread and read marks across devices
- Evidence: `apps/web/e2e/sidebar-nav.spec.ts`, `apps/web/e2e/sidebar-projects.spec.ts`, `apps/web/e2e/sidebar-visual.spec.ts`, `apps/web/e2e/sidebar-archived.spec.ts`, `apps/server/test/unread-notifications.test.ts`

### skills

**Skills** (shipped, centrality 3). Skills read from each machine and team skills imported and injected into threads.

States: An empty list, skills per machine, an import dialog, and a skill injected into a thread shown in the transcript.

Reach:

1. `settings skills`
2. `click testid:resource-import`

- Web routes: `/app/resources/skills`
- Settings: `设置` (Settings) › `执行环境` (Execution) › `技能` (Skills)
- Keyboard shortcuts in its code: none
- Test ids in its code: `resource-empty`, `resource-import`
- Verify recipes: [.claude/skills/verify-cairn/features/skills-page.md](features/skills-page.md), [.claude/skills/verify-cairn/features/skill-import.md](features/skill-import.md), [.claude/skills/verify-cairn/features/skills-injection.md](features/skills-injection.md)
- Research: **gap**: no current note on how Amp, t3code and Claude Code manage skills across machines
- Frontend design: [docs/spec/13-resources-view-localization.md](../../../docs/spec/13-resources-view-localization.md)
- Backend design: [docs/spec/14-skills-execution-surface-injection.md](../../../docs/spec/14-skills-execution-surface-injection.md)
- Evidence: `apps/web/e2e/skills-page.spec.ts`, `apps/web/e2e/skill-import.spec.ts`, `apps/daemon/test/skills-catalog.test.ts`

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

### job-applications

**Job applications** (planned, centrality 4). Owner-gated host allow, profile and daily cap for a later host-browser submit.


- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Research: n/a: the owner design is the source; no reference product is copied
- Frontend design: n/a: this slice has no product UI
- Backend design: [docs/design/job-applications.md](../../../docs/design/job-applications.md)
- Evidence: none

### thread-tags

**Thread tags** (shipped, centrality 4). Category UI, vocabulary, seeding and assignment writers are retired; only legacy read/storage compatibility remains.

States: Vocabulary GET/POST return 404; no category seeding or assignment writers remain. Retired tagIds fail before writes across REST/Coordinator/MCP and canonical services, including SDK transports. Existing read-only membership and classification remain until final data removal; GitHub labels are separate.

Reach:

1. `open /app/project/<id of a project listed by the projects API>`

- Web routes: none
- Keyboard shortcuts in its code: none
- Test ids in its code: none
- Verify recipes: [.claude/skills/verify-cairn/features/tags.md](features/tags.md)
- Research: [docs/research/thread-category-runtime-cutover-3481.md](../../../docs/research/thread-category-runtime-cutover-3481.md)
- Frontend design: [docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md](../../../docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md)
- Backend design: [docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md](../../../docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md)
- Evidence: `apps/server/test/task-meta.test.ts`, `apps/server/test/category-vocabulary-retirement.test.ts`, `apps/server/test/category-assignment-retirement.test.ts`, `packages/shared/test/task-request.test.ts`, `apps/server/test/correction-classification.test.ts`, `apps/daemon/test/task-meta-prompt.test.ts`, `apps/daemon/test/worker-meta-sdk.test.ts`

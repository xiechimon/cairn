# Feature map

> Generated from `.claude/skills/verify-cairn/feature-map.json` by `scripts/generate-feature-map.mjs`; do not edit. The agent-facing map with entry points, shortcuts and test ids is `.claude/skills/verify-cairn/feature-map.md`.
> `node scripts/generate-feature-map.mjs --check` runs in the CI `gates` job. It fails when a web route, settings section or server route maps to no feature, a route pattern matches nothing, a reach step names a route, section, test id or key the source does not have, a research or design slot is empty, a linked path does not exist, a shipped feature has no evidence, a generated file is stale, or the PR adds a gap its base did not have.

## Rules

- A feature is a user-facing capability. Each row names its code, routes, reach steps and states, research, frontend design, backend design and the tests that verify it.
- Each of the three slots holds repository links, or `{"gap": "..."}` when the work is missing, or `{"na": "..."}` when the slot does not apply. A gap needs a batch, and a new feature may not add a gap: research and design come first.
- A note that exists but is not on main yet goes under `pending` with where it lives; it counts as a link and renders as `(not on main)`.
- Route patterns match exactly, or by prefix when they end in `**`. Web routes come from `apps/web/src/App.tsx` and the settings sections from `apps/web/src/settings/settings-page.tsx`; server routes are the literal paths registered in `apps/server/src/app.ts` and `apps/server/src/routes*.ts`.
- Centrality follows the plan: 1 is the core loop and 4 is later or peripheral.

## Summary

| Item | Count |
|---|---|
| Features | 58 |
| status shipped | 48 |
| status partial | 8 |
| status planned | 2 |
| research, frontend design and backend design all present or not applicable | 32 |
| Research gaps | 12 |
| Frontend design gaps | 13 |
| Backend design gaps | 17 |
| notes cited but not on main | 19 |

## Coverage

| Feature | Centrality | Status | Research | Frontend design | Backend design | Batch |
|---|---|---|---|---|---|---|
| [The agent's computer](#agent-computer) | 1 | partial | yes | gap | yes | B4 |
| [Coordinator chat](#coordinator-chat) | 1 | shipped | yes | yes | yes |  |
| [Coordinator context and compaction](#coordinator-context) | 1 | shipped | yes | n/a | yes |  |
| [Coordinator dispatch](#coordinator-dispatch) | 1 | shipped | yes | n/a | yes |  |
| [Read-only report history](#daily-report) | 1 | shipped | yes | yes | gap | B2 |
| [Engine run in a task thread](#engine-view) | 1 | partial | yes | yes | yes |  |
| [Harness dispatch](#harness-dispatch) | 1 | shipped | yes | n/a | yes |  |
| [Memory](#memory) | 1 | shipped | yes | yes (not on main) | yes |  |
| [Completed delivery and explicit merge](#merge-gate) | 1 | shipped | yes | yes | yes |  |
| [Task references and needs-you](#needs-you) | 1 | shipped | yes | yes | gap | B2 |
| [Plans, approval and review](#plans-and-review) | 1 | shipped | yes | gap | yes | B3 |
| [Phone push](#push-notifications) | 1 | shipped | yes | gap | gap | B2 |
| [Question cards](#questions) | 1 | shipped | gap | yes (not on main) | gap | B2 |
| [Model and work routing](#routing) | 1 | shipped | yes | yes | yes |  |
| [Reply quote](#selection-reply) | 1 | shipped | yes | yes | yes |  |
| [Steer, queue and stop](#steer-queue-stop) | 1 | shipped | gap | gap | gap | B3 |
| [Machine work protocol](#step-claim) | 1 | shipped | yes | n/a | yes |  |
| [Thread PR panel and auto-fix](#thread-pr-panel) | 1 | shipped | yes | yes | yes |  |
| [Thread transcript and work trace](#thread-transcript) | 1 | shipped | yes | yes | yes |  |
| [Threads](#threads) | 1 | shipped | yes | yes | yes |  |
| [In-app Cairn Cloud account & billing](#cloud-account) | 2 | shipped | n/a | yes | yes |  |
| [Desktop app](#desktop-app) | 2 | planned | yes (not on main) | gap | gap | B6 |
| [First run](#first-run) | 2 | shipped | yes (not on main) | yes | gap | B6 |
| [Machine enrollment](#machine-enrollment) | 2 | shipped | yes | gap | gap | B5 |
| [Machines](#machines) | 2 | shipped | yes | yes | yes |  |
| [File names in replies](#message-workspace-files) | 2 | shipped | yes | yes | yes |  |
| [Mobile web and PWA](#mobile-web) | 2 | shipped | gap | yes | n/a | B6 |
| [Phone computers](#phones) | 2 | partial | yes | yes | yes |  |
| [Model providers and subscriptions](#providers) | 2 | shipped | yes | yes | yes |  |
| [Remote access over the tailnet](#remote-access) | 2 | partial | yes | gap | yes | B5 |
| [Run log](#run-log) | 2 | shipped | yes | yes | yes |  |
| [Login and tailnet device auth](#tailnet-login) | 2 | partial | yes (not on main) | gap | yes | B5 |
| [Token usage](#token-usage) | 2 | shipped | gap | yes | yes | B7 |
| [Account and team](#account-and-team) | 3 | shipped | yes | yes | gap | B10 |
| [API keys](#api-keys) | 3 | shipped | gap | gap | gap | B10 |
| [App shell and settings window](#app-shell) | 3 | shipped | yes (not on main) | yes | n/a |  |
| [Appearance and visual system](#appearance) | 3 | shipped | yes (not on main) | yes | n/a |  |
| [Attachments](#attachments) | 3 | shipped | yes | yes | yes |  |
| [Composer](#composer) | 3 | shipped | gap | yes | gap | B8 |
| [Coordinator over MCP](#coordinator-mcp) | 3 | shipped | gap | n/a | yes | B11 |
| [Design surface](#design-surface) | 3 | partial | yes | yes | yes |  |
| [Built-in git hosting](#git-hosting) | 3 | shipped | gap | n/a | gap | B11 |
| [GitHub connection and issues](#github) | 3 | shipped | yes | yes | yes |  |
| [IM connections](#im-connections) | 3 | partial | n/a | yes | yes |  |
| [Mailbox connector](#mail-connector) | 3 | partial | n/a | yes | yes |  |
| [MCP servers](#mcp-servers) | 3 | shipped | yes | yes | yes |  |
| [Projects](#projects) | 3 | shipped | yes | yes | yes |  |
| [Quota wait](#quota-wait) | 3 | shipped | yes | gap | gap | B9 |
| [Research before retry and plan](#research-loop) | 3 | shipped | yes | n/a | yes |  |
| [Scheduled tasks](#schedules) | 3 | shipped | gap | gap | gap | B7 |
| [Search](#search) | 3 | shipped | gap | yes | gap | B7 |
| [Secrets](#secrets) | 3 | shipped | yes | yes | yes |  |
| [Server backup and deploy status](#server-status) | 3 | shipped | yes | gap | yes | B11 |
| [Sidebar](#sidebar) | 3 | shipped | yes | yes | gap | B7 |
| [Skills](#skills) | 3 | shipped | gap | yes | yes | B9 |
| [Git release tags](#git-release-tags) | 4 | shipped | yes | n/a | yes |  |
| [iOS app](#ios-app) | 4 | planned | gap | gap | gap | B12 |
| [Thread tags](#thread-tags) | 4 | shipped | yes | yes | yes |  |

## Gaps by batch

Batches are ordered by how central their features are. One agent session researches and designs one batch.

### B2 · What reaches the user: needs-you, questions, push

The attention surfaces of the phase 1 graduation criteria: the needs-you tray, question cards and their lifecycle, and phone push. Research Ikaga, Duet, Codex CLI and t3code first; design the tray and card states and the delivery and dedupe rules.

| Feature | Centrality | Missing |
|---|---|---|
| [Read-only report history](#daily-report) | 1 | Backend design: Retired: only chief_message report rows remain for read-only rendering; report-linked steps are stopped and the bookkeeping tables are dropped. |
| [Task references and needs-you](#needs-you) | 1 | Backend design: no design for which records enter the tray, their order and when they leave |
| [Phone push](#push-notifications) | 1 | Frontend design: the notify banner, device switch and push copy have no design<br>Backend design: no design for subscriptions, presence suppression, receipts and the three push states |
| [Question cards](#questions) | 1 | Research: the Codex CLI and t3code question patterns were never written up<br>Backend design: no design for the question lifecycle: parking, late answers, cancel and resume |

### B3 · Thread control and the merge decision

What a user can do to a running thread and how the gate verdict shows: steer, queue, stop, stop-and-done, plan approval with auto-approve, review rejection, and the merge controls with the gate verdict. Research Amp, Claude Code and t3code; design the state machine and the panels.

| Feature | Centrality | Missing |
|---|---|---|
| [Plans, approval and review](#plans-and-review) | 1 | Frontend design: the plan pane, auto-approve countdown and reject flow have no current design |
| [Steer, queue and stop](#steer-queue-stop) | 1 | Research: no note on how Amp, Claude Code and Codex steer, queue and interrupt<br>Frontend design: the queued-message list, steer affordance and stop confirmation have no design<br>Backend design: no design for queue ordering, steer delivery to each harness and stop semantics |

### B4 · Execution isolation: orbs, the agent's computer, own-key sandboxes

The per-task orb differentiator and the execution targets : how a user sees and chooses where a thread runs, the agent's own computer and its screen, and E2B or Daytona with the user's key. Land the coordinator-computer note, then write the backend design and the machine-page and screen designs.

| Feature | Centrality | Missing |
|---|---|---|
| [The agent's computer](#agent-computer) | 1 | Frontend design: the screen view and control handover have no design |

### B5 · Remote access and device and machine auth

Reaching cairn from the owner's other devices and adding machines: the tsnet route list and pairing page, seamless login from tailnet devices, and the browser machine-authorize flow. Design the pages and the enroll and pairing failure modes.

| Feature | Centrality | Missing |
|---|---|---|
| [Machine enrollment](#machine-enrollment) | 2 | Frontend design: the add-machine dialog and authorize page have no design<br>Backend design: no design for the browser enrollment handshake and its failure modes |
| [Remote access over the tailnet](#remote-access) | 2 | Frontend design: the remote access page, route list and pairing flow have no design |
| [Login and tailnet device auth](#tailnet-login) | 2 | Frontend design: the sign-in gate and the signed-in-by-tailnet state have no design |

### B6 · Install to first PR: desktop app, first run, mobile web

The phase 2 graduation path: a stranger installs the desktop app and gets a merged PR in 10 minutes, then uses it from a phone browser. Research the desktop shells and mobile web, and design the app packaging, the first-run checklist backend and the mobile layout.

| Feature | Centrality | Missing |
|---|---|---|
| [Desktop app](#desktop-app) | 2 | Frontend design: no design for the window and install flow<br>Backend design: no design for packaging, process supervision, updates and data location |
| [First run](#first-run) | 2 | Backend design: no design for checklist state and the 10-minute path |
| [Mobile web and PWA](#mobile-web) | 2 | Research: no note on how Amp, t3code and Claude handle mobile web and PWA install |

### B7 · Recurring and finding work: schedules, search, sidebar

Scheduled tasks, the search syntax, and the sidebar with unread marks. Research Amp, Claude Code scheduled tasks and t3code, and design the due-event model, the search index and the unread state.

| Feature | Centrality | Missing |
|---|---|---|
| [Token usage](#token-usage) | 2 | Research: no note beyond GitHub's contribution calendar, which the owner named |
| [Scheduled tasks](#schedules) | 3 | Research: no note on Claude Code scheduled tasks, Amp and the Durable Objects alarm model<br>Frontend design: the Tasks panel Schedules tab and its popover editor have no design note beyond DESIGN.md<br>Backend design: no design for due events, missed runs and continue-thread schedules |
| [Search](#search) | 3 | Research: no note on Amp's search syntax and filters<br>Backend design: no design for the search syntax, index and ranking |
| [Sidebar](#sidebar) | 3 | Backend design: no design for unread and read marks across devices |

### B8 · Composer and attachments

Everything typed or attached before a message is sent: mentions, slash commands, named prompts, drafts that survive a restart and attachments. Research claude.ai, Amp and t3code; design the draft and attachment model.

| Feature | Centrality | Missing |
|---|---|---|
| [Composer](#composer) | 3 | Research: no note comparing composers in claude.ai, Amp and t3code<br>Backend design: no design for server drafts  and named prompts |

### B9 · Execution settings: skills, MCP, harness profile, quota wait

Settings that change how harnesses run on each machine: skills, MCP servers, the opt-in harness profile of spec 30, and quota waits when a subscription runs out. Research t3code and Amp settings and write the missing designs.

| Feature | Centrality | Missing |
|---|---|---|
| [Quota wait](#quota-wait) | 3 | Frontend design: the quota banner and waiting thread state have no design<br>Backend design: no design for rate-limit events, account cooldown and resume |
| [Skills](#skills) | 3 | Research: no current note on how Amp, t3code and Claude Code manage skills across machines |

### B10 · Access settings: secrets, API keys, account and team

Who can do what and with which credentials: the secrets page, API keys with grants, account and team settings with PR attribution. Design the pages and the key and grant model.

| Feature | Centrality | Missing |
|---|---|---|
| [Account and team](#account-and-team) | 3 | Backend design: no design for the single-user account and team record |
| [API keys](#api-keys) | 3 | Research: no note on API key and grant models in reference products<br>Frontend design: the API keys page and grant picker have no design<br>Backend design: no design for key scopes, grants and revocation |

### B11 · Peripheral surfaces

Small surfaces that work today without research or design: the Coordinator MCP face for external harnesses, built-in git hosting, server backup and deploy banners, and thread tags. Each needs a short note and a design, or a decision to retire it.

| Feature | Centrality | Missing |
|---|---|---|
| [Coordinator over MCP](#coordinator-mcp) | 3 | Research: the t3code comparison of plan §21 is not in the repository |
| [Built-in git hosting](#git-hosting) | 3 | Research: no note on serving git over HTTP versus other transports<br>Backend design: no design for auth, repository layout and failure modes |
| [Server backup and deploy status](#server-status) | 3 | Frontend design: the banners have no design |

### B12 · Phase 3: iOS app

Work for after phase 2 graduates: the native iOS app . Research and design only when phase 2 is close.

| Feature | Centrality | Missing |
|---|---|---|
| [iOS app](#ios-app) | 4 | Research: the Optio and t3code comparison has not been done<br>Frontend design: not designed<br>Backend design: not designed |

## Research and design links

### agent-computer

**The agent's computer** (partial). The Coordinator's own persistent computer and guarded access to the user's machine. An idle machine is one quiet row; while an agent acts on it the row shows what it does and the latest step screenshot; the full screen opens on demand with explicit Take over and Give back. Browser and desktop control are always on wherever the machine reports the capability; there is no setting.

- Research: [docs/research/coordinator-computer.md](research/coordinator-computer.md) (not on main), [docs/research/agent-small-computer-2026-11-08.md](research/agent-small-computer-2026-11-08.md) (not on main), [docs/research/user-computer-model-2026-11-08.md](research/user-computer-model-2026-11-08.md) (not on main), [docs/research/resident-cloakbrowser-2026-11-16.md](research/resident-cloakbrowser-2026-11-16.md), [docs/research/mac-agent-browser-prior-art-2026-11-26.md](research/mac-agent-browser-prior-art-2026-11-26.md)
- Frontend design: **gap**: the screen view and control handover have no design
- Backend design: [docs/design/computer-login-handoff.md](design/computer-login-handoff.md), [docs/design/cloakbrowser-computer.md](design/cloakbrowser-computer.md), [docs/design/own-mac-computer.md](design/own-mac-computer.md), [docs/design/mac-host-browser.md](design/mac-host-browser.md)

### coordinator-chat

**Coordinator chat** (shipped). The one never-ending Coordinator conversation on the home page, where the user dispatches work and reads reports.

- Research: [docs/research/coordinator-in-server.md](research/coordinator-in-server.md), [docs/research/dsh-sig-walk-2026-11.md](research/dsh-sig-walk-2026-11.md), [docs/research/pi-durable-spike.md](research/pi-durable-spike.md) (not on main), [docs/research/chat-markdown-polish-2026-11-08.md](research/chat-markdown-polish-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/references/coordinator-chat](design/references/coordinator-chat), [docs/design/pilot-coordinator-chat-2026-11-06.md](design/pilot-coordinator-chat-2026-11-06.md) (not on main)
- Backend design: [docs/research/coordinator-in-server.md](research/coordinator-in-server.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](spec/26-pi-session-runtime-and-trust-surface.md), [docs/design/coordinator-project-channels.md](design/coordinator-project-channels.md), [docs/design/coordinator-quick-replies.md](design/coordinator-quick-replies.md)

### coordinator-context

**Coordinator context and compaction** (shipped). Each Coordinator turn is assembled by the server within a token budget from recent messages, an index of older ones, history tools and ledger facts, so compaction is invisible to the user.

- Research: [docs/research/coordinator-compaction-2026-11-07.md](research/coordinator-compaction-2026-11-07.md), [docs/research/personal-agent-memory-2026-11-07.md](research/personal-agent-memory-2026-11-07.md), [docs/research/coordinator-context-2026-11-08.md](research/coordinator-context-2026-11-08.md)
- Frontend design: n/a: compaction is invisible by design; the transcript keeps full history
- Backend design: [docs/design/coordinator-context-backend.md](design/coordinator-context-backend.md)

### coordinator-dispatch

**Coordinator dispatch** (shipped). The Coordinator opens threads, picks the project, machine and model for each, and orchestrates splits; fixed role agents are retired.

- Research: [docs/research/cairn-dogfood-feasibility-2026-11-06.md](research/cairn-dogfood-feasibility-2026-11-06.md), [docs/research/capability-routing-2026-11-06.md](research/capability-routing-2026-11-06.md), [docs/research/r14-orchestration-parent-card.md](research/r14-orchestration-parent-card.md), [docs/research/r15-agent-responsibility-default.md](research/r15-agent-responsibility-default.md)
- Frontend design: n/a: dispatch shows as one sub-thread row under the reply that started it inside the Coordinator chat
- Backend design: [docs/research/capability-routing-2026-11-06.md](research/capability-routing-2026-11-06.md), [docs/research/r14-orchestration-parent-card.md](research/r14-orchestration-parent-card.md)

### daily-report

**Read-only report history** (shipped). Existing report messages remain readable; daily generation, retries, push and suggestion decisions are retired.

- Research: [docs/research/duet-proactive-coordinator.md](research/duet-proactive-coordinator.md)
- Frontend design: [apps/web/DESIGN.md](../apps/web/DESIGN.md)
- Backend design: **gap**: Retired: only chief_message report rows remain for read-only rendering; report-linked steps are stopped and the bookkeeping tables are dropped.

### engine-view

**Engine run in a task thread** (partial). A run that a task thread dispatched to an engine (Claude Code, Codex) is the thread's own conversation, with time and cost in the usage popover and a raw output view in the thread menu, synthesized from the transcript.

- Research: [docs/design/durable-threads-and-engines.md](design/durable-threads-and-engines.md)
- Frontend design: [docs/design/durable-threads-and-engines.md](design/durable-threads-and-engines.md), [docs/design/references/thread-review](design/references/thread-review)
- Backend design: [docs/design/durable-threads-and-engines.md](design/durable-threads-and-engines.md), [docs/design/side-panels-backend-gaps.md](design/side-panels-backend-gaps.md)

### harness-dispatch

**Harness dispatch** (shipped). Each thread runs on a subscription CLI (Claude Code, Codex, pi) driven by the daemon, mostly through ACP, with the mode fixed at thread start.

- Research: [docs/research/1607-acp-execution-surface.md](research/1607-acp-execution-surface.md), [docs/research/r4-foundation.md](research/r4-foundation.md), [docs/research/r10-multica-runtime.md](research/r10-multica-runtime.md), [docs/research/r11-runtime-gap.md](research/r11-runtime-gap.md), [docs/research/herdr-multica-parity.md](research/herdr-multica-parity.md)
- Frontend design: n/a: harness choice surfaces through routing settings and the thread's model line
- Backend design: [docs/spec/17-dual-runtime-execution-surface.md](spec/17-dual-runtime-execution-surface.md), [docs/design/runtime-memory-out-of-tree.md](design/runtime-memory-out-of-tree.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](spec/26-pi-session-runtime-and-trust-surface.md)

### memory

**Memory** (shipped). Team and project memories the Coordinator reads, writes and injects into later turns and threads. Oversized indexes prompt normal-turn maintenance; no daily tidy pass runs. Owners edit memory conversationally through a durable memory-edit request run on a dedicated chief-memory side thread restricted to the four memory tools, with receipts and before/after diffs. A first-run import card offers CLAUDE.md/AGENTS.md files as unverified searchable memory.

- Research: [docs/research/personal-agent-memory-2026-11-07.md](research/personal-agent-memory-2026-11-07.md), [docs/research/research-loop-plan.md](research/research-loop-plan.md), [docs/research/memory-2026-11-08.md](research/memory-2026-11-08.md), [docs/research/memory-inplace-edit-2026-11-09.md](research/memory-inplace-edit-2026-11-09.md)
- Frontend design: [docs/design/memory-inplace-edit.md](design/memory-inplace-edit.md) (not on main)
- Backend design: [docs/design/memory-backend.md](design/memory-backend.md), [docs/design/memory-inplace-edit.md](design/memory-inplace-edit.md) (not on main)

### merge-gate

**Completed delivery and explicit merge** (shipped). Successful code tasks finish with their branch or PR retained. Only an explicit conversational user request initiates a merge, without a mandatory agent review or merge-choice UI.

- Research: [docs/research/remove-product-merge-gate-2026-11-16.md](research/remove-product-merge-gate-2026-11-16.md)
- Frontend design: [docs/design/remove-product-merge-gate.md](design/remove-product-merge-gate.md)
- Backend design: [docs/design/remove-product-merge-gate.md](design/remove-product-merge-gate.md)

### needs-you

**Task references and needs-you** (shipped). A task the Coordinator creates or mentions shows as one reference row above the reply, tinted by its status, and opens the task panel; the Tasks toggle carries the needs-you count.

- Research: [docs/research/link-roundup-2026-11-01.md](research/link-roundup-2026-11-01.md), [docs/research/ui-ux-audit-2026-11-06.md](research/ui-ux-audit-2026-11-06.md) (not on main), [docs/design/duet-shaped-clients.md](design/duet-shaped-clients.md)
- Frontend design: [docs/design/duet-shaped-clients.md](design/duet-shaped-clients.md)
- Backend design: **gap**: no design for which records enter the tray, their order and when they leave

### plans-and-review

**Plans, approval and review** (shipped). A thread's plan document with approval, timed auto-approve that can be paused, document diffs, and review that can reject work.

- Research: [docs/research/m7-w5-ai-review-slice.md](research/m7-w5-ai-review-slice.md), [docs/research/892-gate-usage-measurement.md](research/892-gate-usage-measurement.md)
- Frontend design: **gap**: the plan pane, auto-approve countdown and reject flow have no current design
- Backend design: [docs/spec/08-m7-feature-closed-loop.md](spec/08-m7-feature-closed-loop.md)

### push-notifications

**Phone push** (shipped). Web Push and APNs to the user's devices when something needs them, suppressed while they are looking at the thread.

- Research: [docs/research/ios-apns-push-2026-11-14.md](research/ios-apns-push-2026-11-14.md)
- Frontend design: **gap**: the notify banner, device switch and push copy have no design
- Backend design: **gap**: no design for subscriptions, presence suppression, receipts and the three push states

### questions

**Question cards** (shipped). Questions from the Coordinator or a thread appear as answerable cards in the conversation where they were asked, never block further messages, and keep per-question drafts.

- Research: **gap**: the Codex CLI and t3code question patterns were never written up
- Frontend design: [docs/design/qcard-variants/README.md](design/qcard-variants/README.md) (not on main), [docs/design/pilot-coordinator-chat-2026-11-06.md](design/pilot-coordinator-chat-2026-11-06.md) (not on main)
- Backend design: **gap**: no design for the question lifecycle: parking, late answers, cancel and resume

### routing

**Model and work routing** (shipped). Which model each kind of work uses: the Model selector page (the Coordinator with model and thinking level, which tasks follow by default, and the frequently used models the Coordinator picks from per task), the Model routing page (providers with quota, Claude billing, and a graph wiring each rule to its provider), capabilities and a per-thread override.

- Research: [docs/research/capability-routing-2026-11-06.md](research/capability-routing-2026-11-06.md), [docs/research/agent-machine-routing.md](research/agent-machine-routing.md) (not on main)
- Frontend design: [docs/design/references/settings](design/references/settings)
- Backend design: [docs/research/capability-routing-2026-11-06.md](research/capability-routing-2026-11-06.md)

### selection-reply

**Reply quote** (shipped). Press Reply in your own message's hover tools to quote it above the composer. Coordinator messages have no reply arrow (owner decision, 2026-11-21); instead, select text in a Coordinator message to get a pill with Quote (R); it opens a one-input box where Enter stages the quote above the composer and Cmd+Enter sends it at once; The sent message carries the quote and its source message id.

- Research: [docs/research/selection-reply-2026-11-08.md](research/selection-reply-2026-11-08.md)
- Frontend design: [docs/design/selection-reply-2026-11-08.md](design/selection-reply-2026-11-08.md)
- Backend design: [docs/design/selection-reply-2026-11-08.md](design/selection-reply-2026-11-08.md)

### steer-queue-stop

**Steer, queue and stop** (shipped). The user can steer a running thread, queue messages behind it, stop it, or stop and mark it done.

- Research: **gap**: no note on how Amp, Claude Code and Codex steer, queue and interrupt
- Frontend design: **gap**: the queued-message list, steer affordance and stop confirmation have no design
- Backend design: **gap**: no design for queue ordering, steer delivery to each harness and stop semantics

### step-claim

**Machine work protocol** (shipped). Daemons claim steps, heartbeat, receive steer and stop, upload results and recover, so the same work runs on any registered machine.

- Research: [docs/research/machine-execution-plane.md](research/machine-execution-plane.md), [docs/research/r13-multica-runtime-verify.md](research/r13-multica-runtime-verify.md)
- Frontend design: n/a: a protocol between server and daemon with no user surface
- Backend design: [docs/research/2513-tla-statecharts.md](research/2513-tla-statecharts.md)

### thread-pr-panel

**Thread PR panel and auto-fix** (shipped). The thread that opens a PR owns it until merge: the PR panel with changes and checks, and wakes on CI, conflicts and review comments.

- Research: [docs/research/thread-pr-placement-2026-11-06.md](research/thread-pr-placement-2026-11-06.md) (not on main), [docs/research/review-findings-before-ready-2026-11-07.md](research/review-findings-before-ready-2026-11-07.md)
- Frontend design: [docs/design/references/thread-review](design/references/thread-review)
- Backend design: [docs/research/thread-pr-autofix.md](research/thread-pr-autofix.md)

### thread-transcript

**Thread transcript and work trace** (shipped). The live transcript of a thread's run: messages, tool rows, thinking, steps and usage in the side panel.

- Research: [docs/research/r15-multica-run-rendering.md](research/r15-multica-run-rendering.md), [docs/research/chat-markdown-polish-2026-11-08.md](research/chat-markdown-polish-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/references/thread-review](design/references/thread-review)
- Backend design: [docs/spec/17-dual-runtime-execution-surface.md](spec/17-dual-runtime-execution-surface.md), [docs/spec/26-pi-session-runtime-and-trust-surface.md](spec/26-pi-session-runtime-and-trust-surface.md)

### threads

**Threads** (shipped). A thread is one piece of work with its own session: created, continued, archived and counted by phase.

- Research: [docs/research/r12-save-and-start-behavior.md](research/r12-save-and-start-behavior.md), [docs/research/r14-orchestration-parent-card.md](research/r14-orchestration-parent-card.md), [docs/research/branch-model-2026-11-08.md](research/branch-model-2026-11-08.md) (not on main), [docs/research/duet-proactive-coordinator.md](research/duet-proactive-coordinator.md)
- Frontend design: [docs/design/references/thread-review](design/references/thread-review), [docs/design/claude-ai-spec.md](design/claude-ai-spec.md)
- Backend design: [docs/spec/23-rework-to-original-branch-and-pr-convergence.md](spec/23-rework-to-original-branch-and-pr-convergence.md), [docs/design/runtime-memory-out-of-tree.md](design/runtime-memory-out-of-tree.md), [docs/research/branch-model-2026-11-08.md](research/branch-model-2026-11-08.md) (not on main), [docs/design/duet-shaped-clients.md](design/duet-shaped-clients.md)

### cloud-account

**In-app Cairn Cloud account & billing** (shipped). Bottom-left sidebar account identity and upward popover (`SidebarAccount`): shows local user display name by default, connects via Clerk PKCE on Cairn Cloud to display Clerk avatar and name, launches hosted Creem subscription checkout and Customer Billing Portal, opens or switches to the ready Cloud workspace, links to local backup migration, and disconnects cleanly.

- Research: n/a: the binding contract is docs/design/in-app-cloud-account.md and the owner-selected Direction 1 prototype
- Frontend design: [docs/design/surfaces/sidebar.md](design/surfaces/sidebar.md)
- Backend design: [docs/design/in-app-cloud-account.md](design/in-app-cloud-account.md)

### desktop-app

**Desktop app** (planned). A web shell that bundles the server, daemon, Coordinator and tsnet, so installing it makes the machine an executor.

- Research: [docs/research/desktop-app-stack-2026-11-08.md](research/desktop-app-stack-2026-11-08.md) (not on main)
- Frontend design: **gap**: no design for the window and install flow
- Backend design: **gap**: no design for packaging, process supervision, updates and data location

### first-run

**First run** (shipped). The setup page before the first project, the Coordinator setup prompt and the first-PR card that take a new user to a first merged PR.

- Research: [docs/research/ui-ux-audit-2026-11-06.md](research/ui-ux-audit-2026-11-06.md) (not on main)
- Frontend design: [docs/design/references/first-run](design/references/first-run)
- Backend design: **gap**: no design for checklist state and the 10-minute path

### machine-enrollment

**Machine enrollment** (shipped). Adding a machine: the daemon starts an enrollment, the user approves it on the authorize page in the browser.

- Research: [docs/research/machine-execution-plane.md](research/machine-execution-plane.md)
- Frontend design: **gap**: the add-machine dialog and authorize page have no design
- Backend design: **gap**: no design for the browser enrollment handshake and its failure modes

### machines

**Machines** (shipped). A compact machine list with names, default marker, system, online state, and a menu for default and delete.

- Research: [docs/research/machine-execution-plane.md](research/machine-execution-plane.md), [docs/research/t3code-devices-and-scope-2026-11-06.md](research/t3code-devices-and-scope-2026-11-06.md) (not on main), [docs/research/runner-token-rotation-2026-11-27.md](research/runner-token-rotation-2026-11-27.md)
- Frontend design: [docs/design/references/settings](design/references/settings), [docs/design/settings-trim.md](design/settings-trim.md), [docs/design/runner-token-rotation.md](design/runner-token-rotation.md), [docs/spec/11-model-service-and-machine-localization.md](spec/11-model-service-and-machine-localization.md)
- Backend design: [docs/design/settings-trim.md](design/settings-trim.md), [docs/design/runner-token-rotation.md](design/runner-token-rotation.md), [docs/spec/11-model-service-and-machine-localization.md](spec/11-model-service-and-machine-localization.md)

### message-workspace-files

**File names in replies** (shipped). Open a filename in a task or Coordinator reply to read it from that step's workspace on the original Runner, without asking the agent to attach it.

- Research: [docs/research/task-file-links-2026-11-28.md](research/task-file-links-2026-11-28.md)
- Frontend design: [docs/design/task-file-links.md](design/task-file-links.md)
- Backend design: [docs/design/task-file-links.md](design/task-file-links.md)

### mobile-web

**Mobile web and PWA** (shipped). The web app installed on a phone: narrow layouts, the service worker and the home-screen app.

- Research: **gap**: no note on how Amp, t3code and Claude handle mobile web and PWA install
- Frontend design: [docs/design/duet-shaped-clients.md](design/duet-shaped-clients.md), [docs/design/references/coordinator-chat](design/references/coordinator-chat), [docs/design/claude-ai-spec.md](design/claude-ai-spec.md)
- Backend design: n/a: served by the same server; push is its own feature

### phones

**Phone computers** (partial). The owner pairs a real phone over adb in Settings, Machines; the Coordinator then sees and drives it with phone_observe and phone_act, with consent, takeover and lock handback.

- Research: [docs/research/phone-agents-2026-11-20.md](research/phone-agents-2026-11-20.md)
- Frontend design: [docs/design/phone-computer.md](design/phone-computer.md)
- Backend design: [docs/design/phone-computer.md](design/phone-computer.md)

### providers

**Model providers and subscriptions** (shipped). The user connects provider keys and subscriptions; Cairn lists live models per source and shows provider quota or Cairn-recorded activity in each subscription.

- Research: [docs/research/r16-model-catalog-liveness.md](research/r16-model-catalog-liveness.md), [docs/research/2330-claude-entrypoint-and-setup-token-quota.md](research/2330-claude-entrypoint-and-setup-token-quota.md), [docs/design/devin-subscription-source.md](design/devin-subscription-source.md), [docs/design/antigravity-subscription-source.md](design/antigravity-subscription-source.md)
- Frontend design: [docs/design/references/settings](design/references/settings), [docs/spec/11-model-service-and-machine-localization.md](spec/11-model-service-and-machine-localization.md)
- Backend design: [docs/design/provider-order.md](design/provider-order.md), [docs/spec/11-model-service-and-machine-localization.md](spec/11-model-service-and-machine-localization.md), [docs/research/r16-model-catalog-liveness.md](research/r16-model-catalog-liveness.md), [docs/design/devin-subscription-source.md](design/devin-subscription-source.md), [docs/design/antigravity-subscription-source.md](design/antigravity-subscription-source.md), [docs/design/doubao-runtime.md](design/doubao-runtime.md)

### remote-access

**Remote access over the tailnet** (partial). The built-in tsnet node with a route list (LAN, tailnet, Funnel), device pairing by QR code and the remote access settings page.

- Research: [docs/research/remote-access-tsnet.md](research/remote-access-tsnet.md), [docs/research/seamless-device-auth-2026-11-08.md](research/seamless-device-auth-2026-11-08.md) (not on main)
- Frontend design: **gap**: the remote access page, route list and pairing flow have no design
- Backend design: [docs/research/remote-access-tsnet.md](research/remote-access-tsnet.md)

### run-log

**Run log** (shipped). Every Coordinator turn and task run kept as a full trace in one run window: a left list of runs (this conversation or every conversation and task run in the team, an optional problems filter) and the selected run's trace on the right (prompt, thinking, each tool call with arguments and output, replies, errors) with the failure up front, folded quiet tool calls and JSON export; reached from the Coordinator mark, the Run log link on a failed or stopped turn, or the task menu.

- Research: [docs/research/dsh-sig-walk-2026-11.md](research/dsh-sig-walk-2026-11.md)
- Frontend design: [docs/design/references/coordinator-chat](design/references/coordinator-chat)
- Backend design: [docs/design/run-trace.md](design/run-trace.md), [docs/design/run-log-window.md](design/run-log-window.md)

### tailnet-login

**Login and tailnet device auth** (partial). The token gate today; next, the owner's own tailnet devices are signed in without a token.

- Research: [docs/research/seamless-device-auth-2026-11-08.md](research/seamless-device-auth-2026-11-08.md) (not on main)
- Frontend design: **gap**: the sign-in gate and the signed-in-by-tailnet state have no design
- Backend design: [docs/research/seamless-device-auth-2026-11-08.md](research/seamless-device-auth-2026-11-08.md) (not on main), [docs/design/pairing-gate-close.md](design/pairing-gate-close.md)

### token-usage

**Token usage** (shipped). The Usage dialog from the sidebar footer: a past-year heatmap of tokens per local day, year totals with days used, daily average and cache hit, the token-type bar, and models and projects ranked for the year or the clicked day.

- Research: **gap**: no note beyond GitHub's contribution calendar, which the owner named
- Frontend design: [docs/design/references/thread-list-sidebar](design/references/thread-list-sidebar)
- Backend design: [docs/design/step-usage-daily.md](design/step-usage-daily.md)

### account-and-team

**Account and team** (shipped). The user's account, language, global external-actions tier and device notification preferences.

- Research: [docs/research/bot-identity-and-coauthorship-2026-11-07.md](research/bot-identity-and-coauthorship-2026-11-07.md)
- Frontend design: [docs/design/references/settings](design/references/settings)
- Backend design: **gap**: no design for the single-user account and team record

### api-keys

**API keys** (shipped). API keys with grants for scripts and external harnesses.

- Research: **gap**: no note on API key and grant models in reference products
- Frontend design: **gap**: the API keys page and grant picker have no design
- Backend design: **gap**: no design for key scopes, grants and revocation

### app-shell

**App shell and settings window** (shipped). The served single-page app, the live team event stream, and the settings window that hosts every section.

- Research: [docs/research/ai-frontend-quality-2026-11-06.md](research/ai-frontend-quality-2026-11-06.md) (not on main), [docs/research/ui-ux-audit-2026-11-06.md](research/ui-ux-audit-2026-11-06.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/references/settings](design/references/settings)
- Backend design: n/a: static serving, a server-sent event stream and two no-op analytics sinks (see docs/privacy.md)

### appearance

**Appearance and visual system** (shipped). Theme, type and the visual language every page follows.

- Research: [docs/research/ai-frontend-quality-2026-11-06.md](research/ai-frontend-quality-2026-11-06.md) (not on main), [docs/research/serif-typography-2026-11-08.md](research/serif-typography-2026-11-08.md) (not on main)
- Frontend design: [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/references/settings](design/references/settings), [apps/web/DESIGN.md](../apps/web/DESIGN.md)
- Backend design: n/a: a client setting with no server state

### attachments

**Attachments** (shipped). Files dropped, pasted or picked into a composer and files agents attach to threads, uploaded by grant and reclaimed later; a sent attachment is a card above the user's message, with its type glyph and first lines, that opens by kind: images and video in a full-window lightbox with a zoned top bar, a filmstrip of the message's media and peeks of the adjacent files; documents (Markdown with a preview/source switch, code with muted highlighting, text, PDF, office) in a right side panel inside the Coordinator layout, one at a time.

- Research: [docs/research/file-preview-reference-2026-11-11.md](research/file-preview-reference-2026-11-11.md)
- Frontend design: [docs/design/references/coordinator-chat/claude-duet-composer-attachment.jpg](design/references/coordinator-chat/claude-duet-composer-attachment.jpg), [docs/design/references/coordinator-chat/claude-duet-file-preview-panel.jpg](design/references/coordinator-chat/claude-duet-file-preview-panel.jpg), [docs/design/references/coordinator-chat/claude-duet-sent-attachment-uploading.jpg](design/references/coordinator-chat/claude-duet-sent-attachment-uploading.jpg)
- Backend design: [docs/spec/20-attachment-reclaim-strategy.md](spec/20-attachment-reclaim-strategy.md), [docs/design/side-panels-backend-gaps.md](design/side-panels-backend-gaps.md)

### composer

**Composer** (shipped). The message composer: mentions, named prompts and drafts that survive closing the app. A leading / is plain text; there is no slash-command menu.

- Research: **gap**: no note comparing composers in claude.ai, Amp and t3code
- Frontend design: [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/references/coordinator-chat](design/references/coordinator-chat)
- Backend design: **gap**: no design for server drafts  and named prompts

### coordinator-mcp

**Coordinator over MCP** (shipped). External harnesses (Claude Code, Codex, pi) talk to the Coordinator and threads through cairn's MCP endpoint.

- Research: **gap**: the t3code comparison of plan §21 is not in the repository
- Frontend design: n/a: an API for other harnesses with no page
- Backend design: [docs/research/desktop-mobile-mcp-forms-2026-11-08.md](research/desktop-mobile-mcp-forms-2026-11-08.md)

### design-surface

**Design surface** (partial). Pages a task makes (deliverable pages and attached .html files) become versions served by Cairn under Open Design's sandbox; the design view previews them beside the Coordinator chat with viewports, versions and restore, element comments forwarded to the task, mark-up, export and share through the user's relay.

- Research: [docs/research/open-design-2026-11-20.md](research/open-design-2026-11-20.md)
- Frontend design: [docs/design/design-surface.md](design/design-surface.md)
- Backend design: [docs/design/design-surface.md](design/design-surface.md)

### git-hosting

**Built-in git hosting** (shipped). The server serves git for local projects so machines can fetch and push without GitHub.

- Research: **gap**: no note on serving git over HTTP versus other transports
- Frontend design: n/a: a git endpoint with no page
- Backend design: **gap**: no design for auth, repository layout and failure modes

### github

**GitHub connection and issues** (shipped). Connecting GitHub, choosing repositories, importing labeled issues as threads and writing results back to the issue.

- Research: [docs/research/bot-identity-and-coauthorship-2026-11-07.md](research/bot-identity-and-coauthorship-2026-11-07.md)
- Frontend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](spec/12-new-project-local-repo-and-github-auth-repo-selection.md)
- Backend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](spec/12-new-project-local-repo-and-github-auth-repo-selection.md)

### im-connections

**IM connections** (partial). Outbound-only chat connections that reach the Coordinator without a native app or a public callback. Telegram connects with a bot token; WeChat connects by scanning a Tencent iLink QR that creates the connection and pairs the scanning account; Slack connects with an app-level token and bot token over Socket Mode; iMessage bridges through imsg on a registered always-on Mac over the machine stream, with no inbound port. Paired senders' messages become coordinator turns, card answers arrive as button taps or replies, and text replies return to the same chat.

- Research: n/a: the binding contract is docs/design/im-connections.md; no reference product is copied
- Frontend design: [docs/design/references/settings](design/references/settings)
- Backend design: [docs/design/im-connections.md](design/im-connections.md), [docs/design/im-bridge.md](design/im-bridge.md)

### mail-connector

**Mailbox connector** (partial). The owner connects an IMAP mailbox (QQ Mail authorization code, Gmail or Outlook app password). One held IDLE connection per mailbox turns new mail into a mail-provenance Coordinator turn with the mail fenced as untrusted data; replies go out over SMTP only after an approval card.

- Research: n/a: the binding contract is docs/design/mail-connector.md; no reference product is copied
- Frontend design: [docs/design/references/settings](design/references/settings)
- Backend design: [docs/design/mail-connector.md](design/mail-connector.md)

### mcp-servers

**MCP servers** (shipped). Connect remote MCP servers from a catalog or by URL and see the local servers each machine configures; every task and review uses what is connected.

- Research: [docs/research/mcp-connectors-2026-11-15.md](research/mcp-connectors-2026-11-15.md)
- Frontend design: [docs/spec/13-resources-view-localization.md](spec/13-resources-view-localization.md), [docs/design/mcp-connectors.md](design/mcp-connectors.md), [docs/design/connector-fabric.md](design/connector-fabric.md)
- Backend design: [docs/spec/13-resources-view-localization.md](spec/13-resources-view-localization.md), [docs/design/mcp-connectors.md](design/mcp-connectors.md), [docs/design/connector-fabric.md](design/connector-fabric.md)

### projects

**Projects** (shipped). Projects as filter and context: create from a local repo or GitHub, a project conversation, settings (base branch, concurrency, autonomy, instructions, local-to-GitHub conversion), archive, unarchive from the sidebar's archived filter, and an archived project opened read-only; the UI offers no project deletion.

- Research: [docs/research/project-coordinators.md](research/project-coordinators.md) (not on main), [docs/research/project-files-retirement-2026-11-09.md](research/project-files-retirement-2026-11-09.md), [docs/research/archived-projects-entry-2026-11-09.md](research/archived-projects-entry-2026-11-09.md)
- Frontend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](spec/12-new-project-local-repo-and-github-auth-repo-selection.md), [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/archived-projects-settings.md](design/archived-projects-settings.md)
- Backend design: [docs/spec/12-new-project-local-repo-and-github-auth-repo-selection.md](spec/12-new-project-local-repo-and-github-auth-repo-selection.md)

### quota-wait

**Quota wait** (shipped). When a subscription hits its limit, threads wait for the reset and the board says so.

- Research: [docs/research/2330-claude-entrypoint-and-setup-token-quota.md](research/2330-claude-entrypoint-and-setup-token-quota.md)
- Frontend design: **gap**: the quota banner and waiting thread state have no design
- Backend design: **gap**: no design for rate-limit events, account cooldown and resume

### research-loop

**Research before retry and plan** (shipped). Threads research outward when a fix keeps failing or a new mechanism is planned, and cite sources in their plan.

- Research: [docs/research/research-loop-plan.md](research/research-loop-plan.md)
- Frontend design: n/a: research runs inside threads and shows as ordinary transcript rows
- Backend design: [docs/research/research-loop-plan.md](research/research-loop-plan.md)

### schedules

**Scheduled tasks** (shipped). Recurring work that starts or continues threads on a schedule, with run-now and a project schedule.

- Research: **gap**: no note on Claude Code scheduled tasks, Amp and the Durable Objects alarm model
- Frontend design: **gap**: the Tasks panel Schedules tab and its popover editor have no design note beyond DESIGN.md
- Backend design: **gap**: no design for due events, missed runs and continue-thread schedules

### search

**Search** (shipped). The search palette with its query syntax.

- Research: **gap**: no note on Amp's search syntax and filters
- Frontend design: [docs/design/references/thread-list-sidebar](design/references/thread-list-sidebar), [docs/design/claude-ai-spec.md](design/claude-ai-spec.md)
- Backend design: **gap**: no design for the search syntax, index and ranking

### secrets

**Secrets** (shipped). Encrypted secrets and readable environment variables; first-use browser passwords ask for website approval in chat; the vault settings section lists saved site logins and per-site fill authorizations.

- Research: [docs/research/1775-gateway-prior-art.md](research/1775-gateway-prior-art.md), [docs/research/browser-secret-fill-2026-11-16.md](research/browser-secret-fill-2026-11-16.md)
- Frontend design: [docs/design/browser-secret-fill.md](design/browser-secret-fill.md)
- Backend design: [docs/research/1775-secret-gateway-design.md](research/1775-secret-gateway-design.md), [docs/design/browser-secret-fill.md](design/browser-secret-fill.md), [docs/design/secret-request-card.md](design/secret-request-card.md)

### server-status

**Server backup and deploy status** (shipped). Banners that warn when backups are stale or the deployed server lags main.

- Research: [docs/research/deploy-drain-2026-11-09.md](research/deploy-drain-2026-11-09.md)
- Frontend design: **gap**: the banners have no design
- Backend design: [docs/ops/deploy-drain-design.md](ops/deploy-drain-design.md)

### sidebar

**Sidebar** (shipped). The sidebar tree: the Coordinator row with its projects hung under it on a tree guide, owner-made project groups as folder rows, a needs-you dot, the project menu (rename, project settings, move to group, archive), the group menu, the project filter (active, archived, all) with the archived row menu (unarchive) and the machine-status footer.

- Research: [docs/research/sidebar-coordinator-icon-2026-11-08.md](research/sidebar-coordinator-icon-2026-11-08.md) (not on main), [docs/research/archived-projects-entry-2026-11-09.md](research/archived-projects-entry-2026-11-09.md)
- Frontend design: [docs/design/references/thread-list-sidebar](design/references/thread-list-sidebar), [docs/design/references/coordinator-chat](design/references/coordinator-chat), [docs/design/claude-ai-spec.md](design/claude-ai-spec.md), [docs/design/archived-projects-settings.md](design/archived-projects-settings.md)
- Backend design: **gap**: no design for unread and read marks across devices

### skills

**Skills** (shipped). Skills read from each machine and team skills imported and injected into threads.

- Research: **gap**: no current note on how Amp, t3code and Claude Code manage skills across machines
- Frontend design: [docs/spec/13-resources-view-localization.md](spec/13-resources-view-localization.md)
- Backend design: [docs/spec/14-skills-execution-surface-injection.md](spec/14-skills-execution-surface-injection.md)

### git-release-tags

**Git release tags** (shipped). The existing daemon-local create_tag tool creates and pushes annotated Git tags, independently of task categories.

- Research: [docs/research/thread-category-runtime-cutover-3481.md](research/thread-category-runtime-cutover-3481.md)
- Frontend design: n/a: an existing daemon-local repository tool with no UI
- Backend design: [docs/research/thread-category-runtime-cutover-3481.md](research/thread-category-runtime-cutover-3481.md)

### ios-app

**iOS app** (planned). A native phone app with Live Activities, forked from Optio or t3code when the time comes.

- Research: **gap**: the Optio and t3code comparison has not been done
- Frontend design: **gap**: not designed
- Backend design: **gap**: not designed

### thread-tags

**Thread tags** (shipped). Category UI, vocabulary, seeding, assignment writers and legacy storage are fully removed; the tag/todo_tag tables and tagIds wire fields are gone.

- Research: [docs/research/thread-category-runtime-cutover-3481.md](research/thread-category-runtime-cutover-3481.md)
- Frontend design: [docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md](spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md)
- Backend design: [docs/spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md](spec/15-untitled-new-task-view-and-fixed-tag-vocabulary.md)

## Notes cited but not on main

| Note | Where it is |
|---|---|
| `docs/design/memory-inplace-edit.md` | owner-approved design in PR #3677; layout implementation owned by PR #3666 |
| `docs/design/pilot-coordinator-chat-2026-11-06.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/design/qcard-variants/README.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/agent-machine-routing.md` | branch origin/claude/elegant-jones-a3e2a9 |
| `docs/research/agent-small-computer-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/ai-frontend-quality-2026-11-06.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/branch-model-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/chat-markdown-polish-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/coordinator-computer.md` | branch origin/docs/coordinator-computer |
| `docs/research/desktop-app-stack-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/pi-durable-spike.md` | branch origin/docs/pi-durable-spike |
| `docs/research/project-coordinators.md` | branch origin/docs/project-coordinators |
| `docs/research/seamless-device-auth-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/serif-typography-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/sidebar-coordinator-icon-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/t3code-devices-and-scope-2026-11-06.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/thread-pr-placement-2026-11-06.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/ui-ux-audit-2026-11-06.md` | uncommitted in worktree project-review-52869e (2026-11-08) |
| `docs/research/user-computer-model-2026-11-08.md` | uncommitted in worktree project-review-52869e (2026-11-08) |

# 08 · M7 Feature Closed Loop (finalized by the 2026-09-26 grilling)

> Canonical status: this volume = the spec source of truth for the M7 milestone
> "feature closed loop". The directional framework continues volume 06 D1
> (own product; the parity-replication obligation is released); M0–M6 see volume 03
> (historical archive).
> Ruling source: the 2026-09-26 grilling, three rounds finalized (closed-loop
> standard / scope / waves / verification / voice handling / end state).

## 0. Ruling Overview

| # | Item | Ruling |
|---|---|---|
| C1 | Closed-loop standard | **Full real closed loop**: the functionality behind each button is wired end to end through frontend → server → daemon; the only exception = voice input is not built |
| C2 | Scope | the currently rendered interactive elements + reverse gaps (surfaces todos.dev has but the pacman UI does not); inherits volume 02's exclusions |
| C3 | Waves | by dependency layer: M7-W1 ledger + supplementary capture → M7-W2 pure frontend → M7-W3 server → M7-W4 daemon → M7-W5 heavy features |
| C4 | Inventory | the M7-W1 first ticket merges the ledger: r1/r2 feature inventory × current UI × volume 05 §6 registry surface × the 2026-09-26 dead-button sweep, a four-way reconciliation |
| C5 | Voice | the two voice buttons (composer / new-task dialog) are removed; the feature is not built; no parity burden (volume 06 D1) |
| C6 | Verification | **every feature must have verify-pacman evidence**; the feature map is maintained **on demand** (synced only when the feature surface changes; pure wiring tickets do not mechanically run it) |
| C7 | End state | M7 = the gap ledger is cleared to zero; every ticket's verify evidence is on record |

Wave-namespace note: this volume's M7-W1..W5 are waves internal to M7; volume 06 D9's W1–W4+ are product waves (W1 facade, W2 first release already past). Volume 06 D9 "W3 steer interruption" is folded in as a component of M7-W4.

## 1. Problem Statement

In real usage many buttons do nothing on click: the composer stop button has no handler while streaming, the project-page empty-state new button has no handler, and the detail/resources/settings surfaces scatter menu stubs and dead buttons. In the reference todos.dev most of these are real features (r8 §3.1 measured AI review as a complete agent loop); pacman replicated the pixels without wiring the functionality. After volume 06 turned it into an own product, the closed-loop trade-off standard shifted from "todos.dev equivalence" to "own-product judgment", but the floor of "rendered interactions must work" does not change.

## 2. Solution

One milestone-scale sweep: first merge four sources into a single **gap ledger** (the sole canonical ledger), then clear it to zero in five dependency-ordered waves. The disposition paradigm continues the two-way rule already established by #149/#163/#222 — **has a real surface → wire it up; has no real surface → wontfix charge-off + remove the rendering + pin an e2e assertion**. Every feature-surface closure must carry verify-pacman real-stack evidence.

## 3. User Stories

Core paths:

1. As a user, I want clicking the stop button while streaming to interrupt the current build, so that a runaway agent step does not have to time out
2. As a user, I want the project-page empty-state `新建任务` button to open the new-task dialog, so that the first task can be created in an empty project
3. As a user, I want the `选择仓库` button when creating a project to list selectable repos, so that a project can bind a code repository
4. As a user, I want the `更多` menu buttons on the board/detail/resources pages to open real menus, so that secondary actions are reachable
5. As a user, I want the transcript collapse button on the detail page to collapse long messages, so that long build records are browsable

Heavy features (M7-W5, one feature per ticket):

6. As a user, I want the `待确认` gate to launch AI review (select Agent → review step → blocking auto-revision), so that plan quality gets a second pair of eyes (r8 §3.1 spec on record)
7. As a user, I want the composer and new-task dialog to attach files, so that the agent can see screenshots and files (spec captured in M7-W1)
8. As a user, I want the composer and new-task dialog to @-mention todos/agents, so that context references become explicit (spec captured in M7-W1)
9. As a user, I want the new-task dialog to add tags, so that task classification happens at creation time
10. As a user, I want the branch dialog's `同步到机器` to select a machine and run the sync, so that worktree state is controllable

Reverse gaps (turned into tickets after ledger calibration):

11. As a user, I want the surfaces todos.dev has but pacman lacks to be inventoried and registered, so that the closed-loop boundary is the whole book, not a sample

## 4. Implementation Decisions

### 4.1 Wave structure

- **M7-W1 ledger + supplementary capture** (a single ticket, the blocking prerequisite of every later ticket):
  1. four-way reconciliation produces the gap ledger (r1/r2 feature inventory × current UI interaction surface × volume 05 §6 registry surface × the 2026-09-26 sweep seed values);
  2. supplementary capture of the two todos.dev attachment/mention interaction specs (the account is available; the measured format of the r8 §3.1 precedent);
  3. backend capability inventory: server routes × daemon capabilities × frontend needs, a three-way reconciliation; the W3/W4 holes surface here, not during construction;
  4. output = this volume's Appendix A promoted to the canonical ledger + a per-row disposition branch (wire up / wontfix remove) + each ticket's input.
- **M7-W2 pure frontend**: tier 3 menu stubs + tier 4 external-link handling + tier 1's pure-frontend portion (empty-state new wired to onNewTask, `选择仓库` wired to the repo list). No server/daemon dependency, no blocking edges between tickets, fully parallelizable.
- **M7-W3 server**: the stop (steer endpoint), attachment upload/storage, mention parsing, tag write path and other endpoints completed.
- **M7-W4 daemon**: steer interruption (folds in volume 06 D9 W3), attachment sync, AI review execution capability.
- **M7-W5 heavy features**: AI review / attachment / mention, one feature per ticket, re-sliced and re-assessed before starting.

### 4.2 The two-way disposition rule (continues the #149/#163/#222 precedents)

Each ledger row has only two terminal states:
- **Wire up**: the real surface exists (local-first can carry it) → the handler wires the real chain;
- **Wontfix charge-off**: no local-first real surface → remove the rendering + note the implementation spot + pin an assertion in `dead-buttons.spec.ts`.

### 4.3 Voice

The voice buttons in the composer and the new-task dialog are removed (C5). An exception to the exception: if the M7-W1 supplementary capture finds the mention/attachment interaction strongly coupled to the voice button (the same toolbar layout assumption), the W2 ticket adjusts it in passing, not as a separate item.

### 4.4 Seams

No new seam. The top seam = verify-pacman (isolated-stack real user paths); below it continue integration (stub-llm chain, server×daemon protocol), apps/web e2e (fixture behavior assertions), vitest. The parity harness identity continues volume 06 D1 = a regression tool; M7 does not consume its "parity gate" semantics.

## 5. Testing Decisions

- A good test = only external behavior (the real effect after a button click: API calls, state transitions, UI feedback), not implementation details.
- **Every feature gets verify-pacman evidence** (C6): screenshots + API JSON + SQLite rows land under `.claude/verify-evidence/`.
- Wontfix-removal dispositions continue to pin assertions in `apps/web/e2e/dead-buttons.spec.ts` (precedent #149/#222).
- The server/daemon protocol layer goes through the integration stub-llm chain (the m4b precedent).
- The feature map is maintained on demand (C6): tickets with feature-surface changes run maintain-verification-skill, pure wiring tickets do not.
- Test rules continue AGENTS.md: no unit tests after the fact, E2E first, list failure modes before writing the implementation.

## 6. Out of Scope

- Voice input (feature not built, button removed — C5).
- Volume 02 exclusions: paywall / multi-tenant / registration invites / invite flow / cloud multi-tenant isolation.
- streamdown (volume 07: deferred + trigger line); preview-token (volume 05 §6: trigger condition not yet met).
- todos.dev baseline re-photography and pixel parity (volume 06 D1 already released the parity obligation).
- New feature ideas outside this round's ledger (emergent features go to volume 06 D9 W4+).

## 7. Premortem Guardrails (the three causes of death assuming M7 fails)

1. **Ledger omissions**: the r-document measured coverage is incomplete, and new holes surface late in construction → guardrail: the M7-W1 acceptance = four-way reconciliation + the entire-site sweep bundled with supplementary capture + backend capability inventory, all three at once, before the ledger can be sealed.
2. **M7-W5 heavy-feature runaway**: AI review is a complete agent step (modal + review step + auto-revision loop); cramming three features into one wave is guaranteed to rot → guardrail: one feature per ticket, re-sliced before M7-W5 starts.
3. **Evidence theater**: when tickets are many and evidence is scattered, verify degrades into backfilling screenshots → guardrail: evidence = feature-map entry + the minimal critical screenshots, not exhaustive; pure wiring tickets are allowed to substitute an e2e assertion for the verify stack (when the disposition behavior can be covered by a fixture assertion).

## Appendix A · Gap Ledger (canonical ledger, finalized by M7-W1 #303 on 2026-09-26)

> Four-way reconciliation sources: r1/r2 feature inventory × current UI interaction
> surface (#303 verified file by file, including a whole-repo button/onClick
> census) × volume 05 §6 registry surface × 2026-09-26 static sweep seed values;
> the calibration supplementary capture = r9 (`docs/research/r9-attachments-mentions.md`,
> todos.dev measured under login). The two-way disposition rule sees §4.2; each
> row's owning ticket number is the M7 zeroing acceptance unit (C7).
> The "already wired" rows = the verification conclusions of tier 5 unverified
> areas, no construction needed.

### Tier 1 · Core Function Holes

| Row | Location | Disposition | Owner | Spec |
|---|---|---|---|---|
| composer stop button | `detail/composer.tsx` composer-stop (streaming-rendered, no onClick) | Wire up | #308 | r9 §3.3: confirm popover `停止当前这一轮？` + default-checked `丢弃本轮修改` + `正在停止…` transition + running row `已取消` + the todo falls back to the gate of the last completed turn; r1 changelog 09-15/09-16 |
| project-page empty-state new button | `pages/project-page.tsx` prj-tasks-empty-new (no onClick) | Wire up | #305 | r2 24b (empty state → new-task dialog) |
| new-project repo-select button | `pages/project-new-page.tsx` prj-new-repo (no onClick) | Wire up | #305 | r2 07b/07c (repo-select popover → creation commit carried) |

### Tier 2 · Heavy Features Not Wired

| Row | Location | Disposition | Owner | Spec |
|---|---|---|---|---|
| AI review ×1 | `detail/composer.tsx` aiReview button (no onClick; the show/hide rule is already implemented = confirm/review and not awaitingReply) | Wire up | #312 | r8 §2.5/§3.1 (modal 560 → select Agent → review step → findings → blocking auto-revision) |
| attachment ×2 (composer + new-task) | composer Paperclip button + `overlay/new-task-dialog.tsx` toolbar button (both no onClick) | Wire up | #310 | r9 §3.1/§4: `POST /api/uploads/grant` → a separate upload host (FormData) → content serialized as `![name](attachment:attachments/{teamId}/{id}.{ext})`; new task = carries the description with the spec |
| mention ×2 (composer + new-task) | the same two Grid2x2 buttons (both no onClick) | Wire up | #311 | r9 §3.2: five-group popover (tasks/skills/Agents/projects/machines, multi-select accumulate + the inserted (N) footer) + composer `@` key inline agents completion; serialization `@name`→`[name](agent:{id})`, tasks `#seq` |
| new-task add tag | `overlay/new-task-dialog.tsx` new-task-tag-add (no onClick) | Wire up | #309 | r9 §3.4: tag panel (pill toggle + inline create form) → `POST /api/projects/{id}/tags {name,color}` → createTodo body carries `tagIds`; fresh-detail meta area chip rendering. **Calibration: the board card does not render tags (r9 measured; the #309 AC card-surface assumption corrected)** (#445 revision: this calibration is retired — the board card renders tag chips, see ADR 0002 F4 revision) |
| branch dialog sync + machine selection | `detail/branch-dialog.tsx` dlg-machine (no onClick) + dlg-sync (always disabled) | Wire up | #319 | r1 changelog 09-13: machine selector + sync directory + force switch + pending→running→synced/failed result card; usable by any team member |

### Tier 3 · Menu/Navigation Stubs

| Row | Location | Disposition | Owner | Spec |
|---|---|---|---|---|
| chief drawer `更多` | `chief/chief-drawer.tsx` hasThread ⋮ button (no onClick) | Wire up | #306 | r9 §3.5: change icon / rename topic / delete topic (the UI entry of r1 changelog 09-08) |
| schedules card `更多` | `pages/schedules-page.tsx` sched-card-more (no onClick) | Wire up | #306 | r9 §3.5: edit / remove (remove has no confirm popover; server DELETE already exists) |
| skills sort | `resources/skills-page.tsx` res-sort (no onClick) | Wire up | #306 | the reference site's click behavior not captured (r7 08); semantics [designed] same family as prj-tasks-menu (client-side sort) |
| account-swap | `routes/account-page.tsx` account-swap (no onClick; #148 already ruled wontfix but the button still renders) | Wontfix remove (completes the #148 ruling) | #306 | #136/#148 on record: static avatar assets with no upload surface |
| plan-dropdown row | `overlays/plan-dropdown.tsx` single row no onClick = **same shape as the reference site** (the r5b 05f type-select marker is not a confirm entry, no gap); `detail/docpane.tsx` VersionMenu version row onClick = only closes the menu (does not switch version, reference-site behavior not captured) | type-select no gap; the version-row semantics [designed] ruled (switch the displayed version or keep menu-close) | #306 | r5b 05f / r8 63 (version-row click not captured) |
| transcript collapse | `detail/transcript.tsx` chat-collapse collapse button (no onClick) | Wire up | #306 | r8 63–77 toolgroup expand/collapse family (client-side state) |
| [calibration added]more-menu complete/close rows | `overlay/more-menu.tsx` complete/close onClick=onClose (dismiss stub; the "wait for backend line" note is expired) | Wire up | #318 | r1 changelog 09-16: Complete = confirm-and-merge (phase-adapted); Close = close semantics (the delayed Undo window is ticket-internal discretion) |
| [calibration added]start-task dialog unified surface | `detail/overlays.tsx` RerunDialog rerun-agent-row dead button (masked by the backdrop div's onClick count) + the split-use switch static span; the `待开始` phase directly startBuild with no dialog | Wire up | #318 | r9 §3.6: Agent row selector (including unassigned) + machine row (auto/specified + online dot) + split-use switch ON = planning/execution dual Agent rows (matching the server assignment two slots) + plan-first/run-now |
| [calibration added]reuse plan `查看方案` | `detail/overlays.tsx` ReusePanel onView=closeOverlay (stub) | Wire up (display shape [designed] ruled) | #318 | reference-site behavior not captured (r8 §5 registered; r9 §5 re-registered); the plans read surface already exists |
| [calibration added]project task row no click | `pages/project-page.tsx` prj-task-row / prj-task-card (div) | Wire up (navigate /app/todo/:id) | #318 | r2 §2 (the reference site opens task detail on row click) |
| [calibration added]new-task unsaved gate | `overlay/new-task-dialog.tsx` close closes directly | Wire up | #318 | r9 §3.4: `放弃新建任务？未保存的内容将丢失。` confirm popover (continue editing / discard and close) |

### Tier 4 · Doc/External-Link Type (wontfix remove)

| Row | Location | Disposition | Owner | Spec |
|---|---|---|---|---|
| keys-docs | `routes/api-keys-page.tsx` `查看文档` button (no onClick) | Wontfix remove | #307 | #149 precedent (local-first has no docs site) |
| res-doclink | `resources/parts.tsx` EmptyState `查看文档` (shared spot, covers all resource empty states) | Wontfix remove | #307 | #149 precedent |
| create-agent swap | `routes/create-agent-dialog.tsx` dlg-agent-swap (no onClick, note in place) | Wontfix remove | #307 | #136/#148 family: no upload surface |
| prj-set-change | `pages/project-settings-page.tsx` prj-set-change (no onClick, note in place) | Wontfix remove | #307 | #177/#148 family: no upload surface |

### Tier 5 · Unverified Areas (#303 fully verified as wired)

| Area | Verification conclusion | Status |
|---|---|---|
| dhead | back navigation (carries search) / chip popover (#67/#209) / docs\|chat tabs / more→MoreMenu / branch / token / history overlay / primary buttons (start/confirm/done/reopen/rerun split by phase, live mutation) — all wired | already wired |
| docpane | type-select listbox (#149) / version menu + compare (r8 65–72 live) / expand all collapse / show full file (#225/#244) — all wired; the version-row close-only goes to tier 3 | already wired |
| overlays family | board-guide (#149 real-content popover) / chip-popover (edit assignment #209) / search-panel (live server-side search #286) — all wired | already wired |
| sidebar family | nav Link family / sidebar collapse persistence (#55) / project-resources group collapse (#147) / user menu / ⌘K — all wired | already wired |
| schedules live | GET+POST live (05 §1.3, SSE todo linkage); card-level edit/remove go to tier 3 | already wired (card-level to #306) |
| remaining re-checks | board/todo-card (start→startBuilds, branch icon→overlay) / user-menu (theme) / team-page (layout + create Agent) / chief-settings (patchChief three surfaces) / chief-wake/form popover family (provider/secret/mcp/agent/api-key/machine #181) / token-gate (form submit) / skills-import (#233/#235) — onClick count re-check + 05 §1.3 cross, all wired | already wired |

### Reverse Gaps and Registry Surface (r1/r2 × r9 calibration, not dead buttons)

| Row | Current vs reference site | Disposition | Owner | Spec |
|---|---|---|---|---|
| chief composer attachment/mention | pacman already wontfix-removed per #136; the reference-site chief composer really has them (r9 §3.5: voice/add-attachment/mention three buttons) | ticket-internal discretion (reinsert or not — spec §3 stories 7/8 name only the composer and new-task) | #310/#311 | r9 §3.5 |
| failed-surface send message | pacman: the failed-phase composer is writable but onSend has no failed branch = **silently drops the draft**; the reference site measured = send triggers a new round (the message enters the conversation with the new round) | Wire up | #320 | r9 §3.3 |
| steer endpoint fork | reference site uses `POST /api/conversations/{id}/steer`; pacman goes through the messages endpoint build branch (#280) — payload equivalent, path forked | [designed] note (alignment is ticket-internal discretion) | #308 | r9 §4 |
| name-edit glyph | account/project-settings SquarePen = static span render; reference-site behavior not captured (r2 §9-20 untested), server has no PATCH user/me and no PATCH projects | keep static + note (same rule as the branch-chip #149 staticization; re-open a ticket if supplementary capture proves the reference site is editable) | — (no construction needed) | r2 §11-20 |
| detail route shape | reference site now /app/todo/:id independent route (r2-era panel=todo: query-param shape has drifted); pacman already matches | no gap | — (no construction needed) | r9 |

## Appendix B · Backend Capability Inventory (server × daemon × frontend needs, finalized by #303)

> server current state = all 75 routes enumerated (`apps/server/src/routes.ts`) +
> a close read of the services surface;
> daemon current state = the machine wire 13 endpoints + a close read of
> machine-loop/AgentSessionHandle;
> needs = each row of Appendix A. The W3/W4 holes surface here.

| Need | server current | daemon current | Gap | Ticket |
|---|---|---|---|---|
| stop/steer | the steer write surface is **end-to-end present**: `POST /api/conversations/{id}/messages` build branch (sendBuildSteer: claimed-step gate 409 + steer_pending single slot + machine steer signal, #278/#280) + `GET /api/machine/steer` pull confirmation | machine-loop steer event → pull → `live.steer()` delivery present (#279) | **the stop path is entirely missing**: `AgentSessionHandle.stop()` interface exists but no server endpoint / wire event / daemon dispatch; interruption bookkeeping (running-row `已取消` + gate fallback + rewind — the M3 checkpoint/restore base is present) | #308 |
| tags | `GET /api/projects/{id}/tags` present; `PATCH /api/todos/{id}` tagIds slot present (todo_tag join full replacement) | not involved | `POST tags {name,color}` (the tag record lacks the color/createdAt/v three fields); createTodo body lacks tagIds; tag delete/management surface (reference site = project settings `标签` tab); the web surface | #309 |
| attachment | vocabulary stub only: chief-tools/mcp-face `attachment` tool returns `attachment store not wired`; no table, no endpoint, no upload surface | none | **full stack**: uploads grant endpoint + storage + content serialization (`attachment:` markdown) + spec/message carrying + agent-side read (tool round-trip); wire spec = r9 §4 | #310 |
| mention | zero | zero | **full stack**: entity resolution (`agent:` scheme markdown) + transcript chip rendering (chief Segments `#N`/agent chip base reusable) + selector UI; spec = r9 §3.2 | #311 |
| AI review | steps action vocabulary has only revision/confirm; step kinds = plan/build/merge | the step execution loop present (claim/heartbeat/done/upload-urls) | review action + review step kind + findings message wire + blocking auto-revision loop (the revision machine reusable: feedback injection re-planning) | #312 |
| branch sync | machine wire 13 endpoints have no sync family; no server command slot | no sync command (git/worktree base present) | server sync command slot + pending/running/synced/failed state bookkeeping + wire event + daemon git sync execution + web machine selection | #319 |
| more-menu complete/close | merge endpoint present (review→done, 202 delegated); PATCH phase funnel `todo/failed→closed` present | merge step present | `review/confirm/done→closed` funnel edge (reference site \*→closed); frontend menu-row wiring | #318 |
| chief ⋮ three rows | threads GET/POST present + `PATCH /api/teams/{id}/chief` (charter/compaction etc.) present | not involved | thread-level PATCH (title/emoji, r1 changelog 09-08) + DELETE thread | #306 |
| schedule card ⋮ | `GET/POST/DELETE /api/schedules` all present | not involved | `PATCH /api/schedules` (edit); frontend menu (r9 §3.5: edit/remove) | #306 |
| failed-surface send | startBuilds present; failed→queued funnel edge present | step loop present | failed-surface send action slot (reference-site wire shape uncaptured, r9 §5 — went through the steps endpoint, body unrecorded); frontend failed branch | #320 |
| rest | machines/search/notifications/OAuth (github-copilot family)/skills (incl. scan)/projects (tree/file/commits/DELETE) already present (05 §1.2/§1.3) | 13 endpoints all present (enroll/claim/heartbeat/tool/token/upload/done/steer) | — (M7 out-of-scope items see §6 and volume 05 §6) | — |
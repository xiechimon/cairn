# 03 · Build-order ROADMAP (ratifying form, #45 final draft)

> Canonical status: this volume = the full build order and milestone-acceptance index of the replication implementation. The concrete pixel/functional-parity acceptance rules are in `04-acceptance-criteria.md`; architecture obligations in `02-architecture-parity.md`; the stack and pins in `01-stack-v2.md`; the foundation in `00-foundation-decisions.md`.
> Ruling source: the #45 grilling's eight questions (2026-09-22); item-by-item records are in the issue resolution comment.

## 0. Summary of rulings

| # | Ruling |
|---|------|
| R1 | Notifications keep the deliberate divergence: SSE + in-page `new Notification()` (fired when `document.hidden`); Web Push does not enter the spec (02 §9.1 already ruled and backfilled) |
| R2 | The ROADMAP is **ratifying**: the UI-first fait accompli (#52–#58) is incorporated as a passed milestone, and one volume covers the full build order |
| R3 | Minimal spec-volume additions: this volume + volume 04; the existing 00/01/02/asset-replacement-plan four volumes are not reorganized |
| R4 | The 44 [inferred] spots are not zeroed (the 1:1 criterion permits black-box approximation); no more internal-structure research tickets; the remaining-evidence checklist is in volume 04 Appendix A |
| R5 | Two lines in parallel: the web-pixel line continues #52's own ticket flow; the backend line goes shared → server → daemon → orchestration; the merge point = fixture switching to the real API |
| R6 | Baseline-capture mixed system: dynamic surfaces concentrated into one r8 ticket (while the tds+BYOK environment still exists), static surfaces captured per web ticket along the way |
| R7 | Functional parity has a two-layer acceptance: the wire layer goes field-by-field automation into CI + the behavior layer is a scenario checklist with semi-automatic E2E (volume 04 §3/§4) |
| R8 | This volume + volume 04 landing = map #34's destination reached; fog-item dispositions see §6; the wayfinder retires, and implementation effort continues in its own ticket flow |

## 1. Positioning and the two-line structure

The ticket's original plan was "a minimal runnable kernel first, UI later"; the actual execution went UI-pixel-first (#42 prototype → #52 umbrella → #53–#58), producing the apps/web two screens + the parity side-by-side harness + CI gates (the 31-row matrix with 0 failures). This volume ratifies that fact as M0, with no rollback and no rearrangement.

Two lines in parallel (R5):

- **The web-pixel line**: does not depend on the backend (fixture/scenario contracts, `?scenario=<r7 number>`, alive only in parity/dev modes). Continuing #52's ticket splitting: popover tickets, route tickets (one per route), motion tickets, i18n tickets; each ticket's acceptance increment = a matrix row added (volume 04 §2).
- **The backend line**: M1 shared → M2 server → M3 daemon → M4 orchestration; the package boundaries are exactly the 01 §3 monorepo layout.
- **Merge point M5**: the web switches from fixture to the real API, and the end-to-end lifecycle runs live; M6 = functional-parity final verification.

## 2. Milestones

### M0 · UI pixel skeleton + two screens [passed, ratified]

- Delivered (already merged): the apps/web skeleton (#53), the board baseline/card states (#54/#55), the detail baseline/deep layers (#56/#57), the closing navigation loop + full-matrix final verification (#58).
- Acceptance (already achieved): the parity 31-row matrix with 0 failures enters CI (typecheck + biome + parity); the threshold system finalized per volume 04 §2.

### M0+ · remaining web-line surfaces (parallel with M1–M4)

- Scope: 13 missing routes (schedules / project×3 / resources×6 / team / account / api-keys / feedback); ~14 popover classes (new-task dialog, start-task, ⌘K search, more menus, chip popovers, plan-type dropdown, delete confirmation, token usage, branches & PRs, run history, acceptance confirmation, interactive user menu, AI-review button); motion/drag-sorting; live streaming; i18n wiring; the Chief panel.
- PWA note: manifest/sw.js execute the byte-level carry-over obligation per 01 §4; **the sw.js push handler keeps its file shape and the server does not push** (the R1 divergence, acceptance criterion in volume 04 §5).
- Prerequisites: dynamic surfaces (rejection loop / failure states / reuse-plan / multi-row run history) **have no r7 baseline material** — the r8 concentrated-capture ticket (§4) goes first; static surfaces are captured per ticket along the way (R6).
- Ticket-splitting and acceptance: each ticket adds matrix rows + per-screen thresholds per volume 04 §2's rules.

### M1 · shared package

- Scope: protocol-vocabulary schemas (02 §5/§6 in full), record shapes (02 §6.2, the projection source of 24 tables), the nine-value phase enum (02 §4.1), the brand-string naming-constant table (02 §5.8).
- Acceptance: vocabulary-schema snapshot tests green (01 §7.4); no field shapes invented beyond 02 (01 §6 migration discipline).

### M2 · server

- Scope: Hono REST + SSE all endpoints (02 §6.1 vocabulary, all-SSE no WS); SQLite + Drizzle 24-table migrations into the repo (01 §6); git http-backend local-bare hosting + the GitHub-connection dual shape (02 §3); cron scheduling (02 §9.2 vocabulary copied); notification SSE events (02 §9.1 + the R1 divergence); search `GET /api/search` (self-set, 02 §6.3); the SecretBox keyfile three-layer keys (02 §8, detailed plan = the 01 §4.2 handoff item); single-user seed + team shape kept (02 §2).
- Acceptance: the M2-surface endpoint wire side-by-side green (volume 04 §3); the behavior-layer M2 scenario list (volume 04 §4).

### M3 · daemon (executor)

- Scope: pure-JS npm package (01 §4.3); pi 0.85.1 consumed through the `AgentBackend` seam (01 §5 signature closure; importing outside the seam = lint red); the machine protocol claim ~75s + SSE wake, the full `/api/machine/*` vocabulary (02 §5); the worktree contract (`tds/conv-*`, checkpoint, 7-day reclamation); the three step kinds' execution + journal; upload-urls round trip; merge `202 delegated`; per-step credential delivery not on disk (02 §8).
- Acceptance: executor-protocol field-by-field side-by-side (02 §5 canonical); the single-machine lifecycle todo→done live run (02 §4.2's main timeline = the E2E spine).
- **The T2 time box (handed off from volume 00, set here)**: verified within M3's first ticket that the `AgentSession` seam supports host durable orchestration (persistent step queue + recover); the time box = M3's first ticket; if it does not hold, 00/T2 fires and D3 is re-evaluated, **not dragged into M4**.

### M4 · orchestration

- Scope: Chief = special Agent (pi session + `remoteTools[]` relay, the 49-vocabulary per 02 §4.3 + r5 §2 black-box approximation); the wording→spec three-part transform (r5 §2.3); dispatch responsibility-text weights (r5 §2.4 A/B evidence); the memory write path (`save_memory`, instruction-triggered + discretion, the provenance shape, the 100 quota, 02 §4.4/r5 §6); the rejection loop plan v2 + unified diff (02 §4.2/r5 §4); the dual-Agent dispatch `assignment:{plan,build}` (r5 §5); the MCP dual surfaces (team-server per-Agent authorization + remote MCP + key-level tool allowlists, 02 §7); the notification matrix's three in-app events (02 §9.1 r5 re-adjudication).
- Acceptance: the behavior-layer M4 scenario list = the r5 six-item measurement checked item by item (volume 04 §4); [inferred] items like the memory read-side injection form fire when touched and verify back (volume 04 Appendix A).

### M5 · merge

- Scope: the web switches from fixture to the real API (the scenario parameter retires to dev-only or is deleted); live streaming connects to the real SSE; the r8-captured baselines enter the matrix; the end-to-end lifecycle runs live on the UI (create → plan → confirm → execute → review → merge → done, including the rejection branch and scheduled rounds).
- Acceptance: the full matrix (including the new r8 baseline rows) 0 failures; the E2E main-timeline full chain green (01 §7.4).

### M6 · functional-parity final verification

- Scope: final verification of all volume-04 criteria — the full pixel matrix, all wire side-by-side green, the behavior-layer checklist checked item by item, and the once-per-real-human items (the OS notification-permission popup, a real desktop-notification fire, OAuth-connecting subscriptions).
- Exit: the acceptance report lands in `docs/spec/` (or archived under parity/output); upgrade tickets open their windows (§3).

### M7 · feature closed loop [passed]

- Scope: settled by volume 08 — dead buttons zeroed and the reverse-gap incorporated. Construction rows 1–4's 23 items (18 connected / 5 removed as wontfix) all landed in their final states; row 5's six regions were verified as "already implemented" by #303; voice removed two buttons per C5. The disposition dichotomy: surfaces with a real object get connected; surfaces without a local-first object get their rendering removed + pinned by `dead-buttons.spec.ts`.
- Exit: the acceptance report lands in `docs/spec/10-m7-acceptance-report.md`; each feature's verify-pacman evidence is archived under `docs/verify/<ticket>/` (criterion see `.claude/skills/verify-pacman/SKILL.md` `证据归档纪律`).

## 3. Upgrade windows and cadence (01 §9 / volume-00 handoff items assembled)

| Item | Cadence |
|---|------|
| pi 0.86.0 | The first D6 upgrade window during M3: read the Breaking section, pass the `AgentBackend` seam regression |
| TS 7.0.2 / react-router 8.4.0 / Tailwind 4.x | Each gets its own ticket after the M6 acceptance (inheriting the old upgrade-ticket discipline) |
| turbo | Fires when CI duration becomes a pain point; not pre-installed |
| transcript virtual scrolling | Decided by measurement at implementation time, not pre-locked (@tanstack/react-virtual candidate) |
| T1/T3 trigger clauses | Can fire at any time; write back to volume 00 + the corresponding ticket comment |

## 4. The r8 concentrated-capture ticket (R6)

- **The implementation effort's first research ticket** (not part of map #34; the map is closed): dynamic-surface baseline captures — the rejection loop's states, failure states, the `复用方案` popover, multi-row run history + the `重跑` button; along the way, the r7 §6 gap-table items that need a real build to trigger (the behavior after clicking the AI-review button).
- Prerequisites: the local tds + BYOK link is usable (the r3/r5 sessions already connected; if the machine is offline, `tds start` first); the environment is at risk of expiring (the site has drifted three times already), so **schedule it first**.
- Discipline: screenshot numbering continues r7 (54+), landing in `docs/research/assets/r8/`; producing `docs/research/r8-*.md`; the new baselines enter the parity-matrix references.
- Static surfaces (resource-page popup forms, dark popovers, the search-panel result state): no concentrated ticket; each web-implementation ticket builds in a capture-first action.

## 5. Per-milestone acceptance-checklist index

| Milestone | Pixel layer | Wire layer | Behavior layer |
|---|---|---|---|
| M0+/each web ticket | matrix row added (04 §2) | — | — |
| M1 | — | schema snapshots (04 §3) | — |
| M2 | — | M2 endpoint side-by-side | M2 scenarios (04 §4) |
| M3 | — | machine-protocol side-by-side | single-machine lifecycle live run |
| M4 | — | — | r5 six-item comparison (04 §4) |
| M5 | full matrix + r8 rows | all endpoints | E2E main-timeline full chain |
| M6 | final verification | final verification | checklist item by item + once-per-real-human items |

## 6. Fog-disposition record (R8, map #34 wrap-up)

| Original fog item | Disposition |
|---|------|
| per-screen UI-spec splitting + pixel-diff tool | Absorbed by reality: #52's ticket splitting (popover/route/motion/i18n tickets) + #53's parity harness already built; the rules were finalized into volume 04 §2 |
| preview-token / tds-tunnel | Moved to volume 04 Appendix B: graduate a design ticket when a UI/wire touchpoint is seen at implementation time (02 §9.3's recorded-but-undesigned standing unchanged) |
| spec-volume structure and publishing format | This volume + volume 04 landing is the final draft (R3) |
| execution-effort startup and organization | Already self-started (the web line #52–#58 ran live); the organization form = `ready-for-agent` tickets + per-ticket implementation sessions; the backend line splits tickets per this volume's §2 milestones |

## 7. Handoff

- Map #34: close it after Decisions-so-far is filled in; the wayfinder retires.
- Implementation-ticket discipline: every ticket self-sufficient (citing the canon-volume chapters, not restating them); inter-ticket context is disposable; the web line continues on `web/NN-*` branches + PRs, the backend line likewise.
- Remaining [inferred] and evidence gaps: the volume-04 Appendix A checklist; verify on the spot when touched at implementation time, and write the results back to 02 §11.

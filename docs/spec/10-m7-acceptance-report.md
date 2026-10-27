# 10 · M7 Feature Closed Loop Final Acceptance · Acceptance Report

> Canonical status: this volume = the landing surface for the acceptance report required by volume 03 §2's M7 exit (`docs/spec/`).
> Single-source caliber = volume 04; M7 rulings and the canonical ledger = volume 08; evidence index = `docs/verify/` (archived with the PRs; the `docs/verify/README`-style harness description sees `.claude/skills/verify-pacman/SKILL.md`).
> Runtime environment: darwin arm64 / Node 26.8.1 / local isolated stack (server 8791 + vite 5273 + scratch `PACMAN_HOME`, running real user paths with the repo's bundled chromium).
> CI surface = ubuntu Node 24 (the existing ci.yml gate).
> Execution date: 2026-09-28.

## 0. Conclusions Overview

| # | Item | Result |
|---|---|---|
| V1 | Gap ledger cleared to zero (C7) | ✅ all 23 construction rows of tiers 1–4 reached their terminal state (18 wired / 5 wontfix-removed); tier 5's 6 rows were verified by #303 as "already wired" with no construction needed; the 5 reverse-gap and registry-surface rows each reached a conclusion |
| V2 | Every feature has verify evidence on record (C6) | ✅ 5 groups of scripted probe evidence archived under `docs/verify/` (#308/#310/#319/#320/#330), plus 3 local directories (see §3 leftovers) |
| V3 | Three gates (lint / format / typecheck) | ✅ recorded per PR + re-run at wrap-up: biome ci 0 errors, `tsc -r` all packages green |
| V4 | main CI | ✅ 14 PRs and the wrap-up commit all green |
| V5 | Dead buttons charged off and pinned | ✅ the two-way disposition rule landed: no local-first real surface → remove the rendering + pin a `dead-buttons.spec.ts` assertion against regression |
| V6 | Voice (C5) | ✅ the two voice buttons in the composer and new-task dialog removed from rendering, no parity burden |
| V7 | Ledger row count reconciliation | ⚠️ see §2.1: M7's tickets cite "26 rows", a row-by-row count is 34 data rows; the per-tier counts see below |
| V8 | Wrap-up re-probe new findings | ⚠️ three real defects surfaced: #344 (stale probe, fixed), #346 (#319 feature unreachable, fixed), #347 (send button occluded, awaiting ruling) |

## 1. Delivery List (14 PRs × owning ticket)

| PR | Title | Owning ticket |
|---|---|---|
| #321 | M7-W1 ledger: four-way reconciliation canonical ledger + attachment/mention spec supplementary capture + backend capability inventory | #303 |
| #313 | two voice buttons charged off (C5) | #304 |
| #314 | tier 4 external-link type four items wontfix charge-off | #307 |
| #316 | M7-W2 menu stub zeroing (six spots reach terminal state per the two-way disposition rule) | #306 |
| #317 | M7-W2 tier 1 two breakpoints wired | #305 |
| #324 | M7-W2 stub-group calibration five spots wired | #318 |
| #325 | composer stop button full chain (popover / `正在停止…` / `已取消` / gate fallback) | #308 |
| #323 | tag vertical slice (dialog UI + server write path + detail chip) | #309 |
| #331 | attachment: composer + new-task full chain | #310 |
| #327 | mention picker + token serialization | #311 |
| #329 | AI review launch modal + review step enqueue + in-review state | #312 |
| #332 | AI review second slice: real findings data flow + blocking auto-revision loop | #330 (duplicated with #326, delivered uniformly by this slice) |
| #322 | failed-surface send = restart with feedback (frontend + server vertical slice) | #320 |
| #328 | branch dialog wired + full-chain sync | #319 |

## 2. Ledger Row-by-Row Reconciliation

### 2.1 Count reconciliation

A row-by-row count of Appendix A of `08-m7-feature-closed-loop.md` (by `|` table rows, excluding header and separator rows):

| Section | Rows | Nature |
|---|---|---|
| Tier 1 · core function holes | 3 | construction (wired) |
| Tier 2 · heavy features not wired | 5 | construction (wired) |
| Tier 3 · menu/navigation stubs | 11 | construction (10 wired / 1 wontfix-removed) |
| Tier 4 · doc/external-link type | 4 | construction (wontfix-removed) |
| Tier 5 · unverified areas | 6 | already wired (#303 verified, no construction needed) |
| Reverse gaps and registry surface | 5 | conclusions each see §2.3 |
| **Total** | **34** | |

Construction rows = 23 (18 wired + 5 wontfix-removed).

**Reconciliation finding**: M7's tickets and PR bodies consistently cite "a 26-row ledger". The row-by-row count is 34 data rows; by the "rows needing construction" caliber it is 23 rows. Both calibers disagree with 26; the cause is that the ledger was expanded twice (#303 first draft → calibration added 5 rows → reverse gaps added 2 rows) without backfilling the total. This report takes the row-by-row count as authoritative; later citations should use the two calibers "Appendix A 34 data rows / 23 construction rows".

### 2.2 Construction-row terminal states (23 rows)

| Tier | Row | Owning ticket | Terminal state |
|---|---|---|---|
| 1 | composer stop button | #308 / #325 | wired |
| 1 | project-page empty-state new button | #305 / #317 | wired |
| 1 | new-project repo-select button | #305 / #317 | wired |
| 2 | AI review | #312 / #329 + #330 / #332 | wired |
| 2 | attachment ×2 (composer + new-task) | #310 / #331 | wired |
| 2 | mention ×2 (composer + new-task) | #311 / #327 | wired |
| 2 | new-task add tag | #309 / #323 | wired (incl. the AC calibration: the board card does not render tags, render surface = detail meta area) |
| 2 | branch dialog sync + machine selection | #319 / #328 | wired (the wrap-up re-probe found the call site dropped buildId, #346 fixed) |
| 3 | chief drawer `更多` | #306 / #316 | wired |
| 3 | schedules card `更多` | #306 / #316 | wired |
| 3 | skills sort | #306 / #316 | wired |
| 3 | account-swap | #306 / #316 | wontfix-removed |
| 3 | plan-dropdown row / version row | #306 / #316 | type-select no gap; version-row semantics [designed] ruled |
| 3 | transcript collapse | #306 / #316 | wired |
| 3 | [calibration] more-menu complete/close rows | #318 / #324 | wired |
| 3 | [calibration] start-task dialog unified surface | #318 / #324 | wired |
| 3 | [calibration] reuse plan `查看方案` | #318 / #324 | wired |
| 3 | [calibration] project task row no click | #318 / #324 | wired (navigate `/app/todo/:id`) |
| 3 | [calibration] new-task unsaved gate | #318 / #324 | wired |
| 4 | keys-docs | #307 / #314 | wontfix-removed |
| 4 | res-doclink | #307 / #314 | wontfix-removed |
| 4 | create-agent swap | #307 / #314 | wontfix-removed |
| 4 | prj-set-change | #307 / #314 | wontfix-removed |

### 2.3 Tier 5 and reverse gaps

Tier 5's six areas (dhead / docpane / overlays family / sidebar family / schedules live / remaining re-checks) were verified file by file by #303 as all "already wired", no construction needed — the verification method and cross-checks are recorded in volume 08 Appendix A.

The five reverse-gap and registry-surface rows, each with its conclusion:

| Row | Conclusion |
|---|---|
| chief composer attachment/mention | wontfix-removed (#146 ruling family: local-first has no backend surface; the composer row keeps only the send button) |
| failed-surface send message | wired (#320 / #322); the wrap-up re-probe added main-repo evidence `docs/verify/320/` |
| steer endpoint fork | [designed] note (payload equivalent, path forked; folded into #308) |
| name-edit glyph | keep static + note (reference-site behavior not captured; re-open a ticket only if supplementary capture proves it) |
| detail route shape | no gap (pacman already matches `/app/todo/:id`) |

## 3. Verify Evidence Index

Scripted probes (isolated-stack real runs, archived into the repo with the PRs):

| Evidence directory | Coverage | checks |
|---|---|---|
| `docs/verify/308/2026-09-28T08-59-10-880Z-stop-button/` | stop button full chain (#308) | 15/15 |
| `docs/verify/309/2026-09-28T13-28-22-804Z-tags/` | tag full chain + the board-card-does-not-render-tags negative (#309) | 11/11 |
| `docs/verify/310/2026-09-28T11-23-04-756Z-attachments/` | attachment three-step wire + composer/new-task dual paths (#310) | 12/12 |
| `docs/verify/311/2026-09-28T13-29-24-524Z-mentions/` | mention three paths (picker ×2 + inline @) + the 0-count group-row negative (#311) | 10/10 |
| `docs/verify/312/2026-09-28T13-32-26-757Z-review-modal/` | AI review launch modal + enqueue + terminal verdict message (#312) | 15/15 |
| `docs/verify/319/2026-09-28T11-32-32-777Z-branch-sync/` | branch sync full chain + the target directory really git-reset (#319) | 15/15 |
| `docs/verify/320/2026-09-28T11-43-34-337Z-failed-send/` | failed-surface restart with feedback (#320) | 11/11 |
| `docs/verify/330/2026-09-27T02-46-23-223Z-review-blocking/` | AI review findings + blocking auto-revision loop (#330) | 23/23 |
| `docs/verify/344/20260928-191821-api-key/` | api-key probe fix re-verification (#344) | 6/6 |

**Coverage note**: every M7 feature ticket has a scripted main-repo probe archived (no more "screenshots only, kept local" gaps). The directories left under `.claude/verify-evidence/` are manual exploration artifacts from construction (screenshots with no checks ledger), not admitted into the repo as evidence.

## 4. Leftovers and Follow-ups

1. **#347 send button occlusion**: `.composer-send` is fully covered by `.detail-fab`, unreachable by mouse (both fixture and live surfaces; the repo's e2e/integration therefore bypass with `dispatchEvent('click')`). Keyboard Enter send is unaffected. The fix needs a human ruling on design intent first — directly related to M7's "dead-button zeroing" goal.
2. ~~#346 fixed but lacked a CI pin~~ **backfilled** (2026-09-28): `integration/test/m7-branch-dialog-e2e.test.ts` real-stack case — the detail page opens the branch dialog and asserts the live surface (machine picker + editable directory input) rather than the fixture placeholder, a discriminant equivalent to "the call site passed buildId". A **regression falsification** was done: removing the `buildId` argument makes the case go red (symptom = `.dlg-machine-picker` not found); restoring it goes green.
3. ~~tags / mentions lacked scripted main-repo probes~~ **backfilled** (2026-09-28): `drive-tags.mjs` (11 checks), `drive-mentions.mjs` (10 checks), evidence archived in `docs/verify/309`, `docs/verify/311`.
4. ~~#312 review-modal evidence not archived~~ **backfilled**: `drive-review.mjs` completed a machine-token re-run 15/15, archived in `docs/verify/312`. In the process a **stale assertion** was found and fixed — that probe previously asserted the text-placeholder wrap-up `AI 审核已完成`, while #330 (PR #332) had already changed the wrap-up contract to the verdict JSON message (`{"kind":"review_verdict",…}`); without the fix this check would stay red for good.
5. **Caliber correction**: later citations of the ledger should use "Appendix A 34 data rows / 23 construction rows" and no longer cite "26 rows" (§2.1).
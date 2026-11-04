# 04 · Acceptance criteria (pixel parity + functional parity final, #45 final draft)

> Canonical status: this volume = the sole criteria volume for replication acceptance. The build order and milestone index are in `03-ROADMAP.md`; the compared behavior/protocol truths are in `02-architecture-parity.md` and the `docs/research/rN` canon.
> Ruling source: the #45 grilling (2026-09-22) Q1/Q4/Q6/Q7/Q8.

## 0. Summary of criteria

| # | Criterion |
|---|------|
| A1 | General rule: indistinguishable from the user's perspective = 1:1; the comparison objects = **the r7 frozen baseline batch + the rN research canon**, not the live official site (the site has drifted three times: measured by r2/r5b/r6) |
| A2 | Pixel layer finalized: Playwright 1440×732 DPR1 screenshots + ffmpeg ssim side-by-side, the threshold system §2; already built (#53 harness), this volume incorporates it as the acceptance canon |
| A3 | Functional layer two-tier (R7): the wire layer = field-by-field automated side-by-side of the 02 §5/§6 vocabulary into CI; the behavior layer = a user-scenario checklist against the rN measurements, semi-automatic E2E + human checks |
| A4 | [inferred] tolerance criterion: server-side internal mechanisms are black-box approximations; the 44 [inferred] marks are not zeroed and do not count as acceptance failures; verify on the spot when touched (Appendix A) |
| A5 | Notification divergence (R1): desktop notifications = SSE + in-page `new Notification()`; the difference from the official Web Push is a **ruled deliberate divergence**, registered and not judged negative |
| A6 | Baseline discipline: if the official site drifts again → re-shoot the baseline volume (r8/r9…) + switch the matrix's baseline references wholesale; old batches are archived, never mixed |

## 1. General rules

- Three acceptance sources: ① the r7 frozen baseline (53 screenshots @1440×732 + icons.json 64 uniques, `docs/research/assets/r7/`); ② the measured behaviors recorded in the rN research canon (r1/r2/r3/r5/r5b/r6/r7, later r8); ③ the canonical vocabularies and record shapes of volume 02.
- **The live official site is not a comparison object**: pixel and behavior acceptance always compare against the frozen batches; the live site serves only as drift-monitoring input (when a drift fact is established → the A6 re-shoot flow, not per-ticket chasing of the new).
- Divergence registration system: wherever the replication differs from the official measurement, it must be on record in the 01 §8 difference-note table or the 02-volume conflict records (ruled); acceptance judges per the registered criterion, not per the official original. Currently effective divergences: notification delivery (A5), the executor distribution form (pure-JS npm package vs 6-platform binaries), the landing framework (single SPA vs Next.js SSG), the unmatched-path redirect.

## 2. Pixel-parity layer (retired)

> **Retirement note**: the pixel side-by-side tooling `parity/` (harness + matrix + r7/r8 baselines) has been removed wholesale — this project no longer does pixel-by-pixel comparison against the reference product. This section and the threshold system and matrix-row contract below are kept as the historical record and no longer constitute a gate.
>
> The current visual-regression gate = the visual specs of the `apps/web` playwright e2e (computed-style geometry assertions pinning radii/heights/font sizes and other hard contracts). The original capture/scoring/localization triple set and the matrix-row contract are recoverable from git history (the `parity/` directory before `chore/remove-parity`).

<details>
<summary>Historical record (rules before retirement)</summary>

**Tooling** (already built, `parity/`, verified live by #53–#58):

- Capture: `vite build --mode parity` (keeping `?scenario=` alive) + `vite preview` 127.0.0.1:8390 + Playwright chromium, viewport 1440×732 DPR1; inject localStorage `pacman-theme` / `pacman.sidebar-collapsed` (brand slots, replaced at the D3 phase #109; the original `tds-*` keys same shape), set `[data-parity-scroll]` scrollLeft; wait for fonts + rAF before the screenshot. A too-wide board = two shots stitched left-right (r7 §0 method). The original-site baseline rows containing brand wording were re-baselined in a batch = `parity/baselines/` (the `rebaseline/` prefix, #109).
- Scoring: ffmpeg `ssim` pairwise scores; artifacts `<id>.png` + `.side-by-side.png` + `.blend.png` (50% ghost) + `report.json` → `parity/output/` (gitignored); any failing row exits 1.
- Localization: `parity/diff-regions.mjs` 24px-cell luminance heatmap + top-25 hot cells; text recovery `parity/match-text.mjs`.

**Matrix-row contract** (the header comment of `parity/matrix.mjs` is authoritative): `{id, route, scenario, theme, scrollLeft?, sidebarCollapsed?, clicks?, fills?, viewport?, baseline?, threshold?}`; baseline refers to an r7 file, rows switching batches use the batch-prefix path (`r8/…`, A6); `clicks`/`fills` are the interaction steps for popover open states (#66); `viewport` is a per-row viewport override — the only current use = the 1440×710 of the r8 78–82 dark rows (the physical cap of the capture window; the centering rule unchanged, the formula per r7 §3.5).

**Threshold system**:

| Tier | Value | Rule |
|---|---|---|
| default | ssim ≥ 0.85 | general for rows with a baseline |
| per-screen override | 0.84 | only for cross-platform font-rasterization-noise screens; condition = a registered reason + a blend human-check showing no structural difference (the current two examples: `detail-confirm-light`, `detail-failed-light`) |
| smoke | 1.0 | no-baseline rows self-compared, verifying the pipeline only |
| report-only | 0 | produces a report without gating (current: 27b/28 expanded states; 79/80 dark confirmation surfaces — the 09-22 site drift is registered in the matrix.mjs row notes, the overlay geometry is guarded by the same-popover fresh-surface gate rows, re-shooting goes to the A6 ticket; `detail-building-dark` and #75's 14-line-long CJK-wrapping surface — the wrap points drift with the renderer's font stack, the blend has been checked with no structural difference, to be tightened after bundling a CJK font or per-host baselines) |

**Increment rule**: each web-implementation ticket's acceptance increment = a matrix row added (new screens/new states/dual themes); popover tickets must include open-state rows; dark surfaces are covered by the same ticket.

**Baseline-batch discipline (A6)**: r7 is the sole current pixel authority (the r5/r6 bitmaps were git rm'd, the DOM tables kept as geometry corroboration). The r8 capture products continue the numbering (54+) landing in `assets/r8/`, and the matrix baselines switch row by row; if the official site drifts wholesale again, re-shoot a volume-level baseline (r9…) and switch the full matrix; mixing two batches in one comparison is forbidden.

</details>

**Gate**: CI (ubuntu, Node 24 + Playwright chromium) runs `typecheck + test + lint + e2e`, triggered on push to main/`web/**`/`prototype/**` and on all PRs; green = the merge premise.

## 3. Functional-parity layer · wire

- Truth = the canonical vocabularies of 02 §5 (executor/machine protocol) + §6 (web REST/SSE/record shapes); shared-package schema snapshot tests vs the 02 tables (01 §7.4).
- Field-by-field side-by-side: endpoint paths, verbs, request/response shapes, SSE event types and payload shapes, the nine-value phase enum, error shapes. Automated into CI (schema snapshots from M1, endpoint-level diff tests from M2/M3).
- [inferred] fields (e.g. the schedule kind enum words, the DELETE surface) are implemented per volume-02's annotation criterion and **not judged negative**; replaying todos.dev's wire at implementation time captures the truth → write back to 02 §11 and then tighten (Appendix A).
- Brand strings: the 02 §5.8 naming-constant table is the single choke point; brand slots in the wire are replaced per the asset-replacement-plan criterion and whitelisted during diffs.

## 4. Functional-parity layer · behavior

- Truth = the measured behaviors recorded in the rN canon. The spine = the E2E main timeline (02 §4.2): create → plan → confirm → execute → review → merge → done.
- Execution: semi-automatic Playwright E2E (on the real API from M5) + a human-check item list.
- Scenario checklist (grouped by milestone, each item with its comparison source):

| Group | Scenario | Comparison canon |
|---|---|---|
| M2 | REST/SSE surfaces: CRUD, team-stream events (todo/build document events + notification events), the search panel, schedule CRUD + the trigger closed loop (the `00/15/30/45` minute tiers, the once-dequeue) | r3 §6/§9, r5 §7.2 |
| M3 | machine onboarding (claim~75s + wake), the worktree contract, checkpoint/recovery, upload-urls, merge 202 delegated, the free one-machine-limit semantics | r3 §1–§5 |
| M4 | the Chief six items: the wording→spec three-part transform, the dispatch responsibility weights, single-todo direct dispatch, the watch/wake three triggers, rejection → plan v2 + unified diff, the dual-Agent assignment slots, memory save_memory (instruction-triggered + discretion + provenance + quota) | r5 §2–§6 |
| M5 | the end-to-end lifecycle live run (including the rejection branch and the scheduled-round stop at review), board card-state transitions, the detail deep-layer states | r3 full chain, r5b |
| M6 | the once-per-real-human items: the OS notification-permission popup allowed by hand, a real desktop-notification fire (divergence criterion A5: an in-page Notification fired when the tab is backgrounded and `document.hidden`), OAuth-connecting own subscriptions (ChatGPT/Codex/Copilot/XAI) | r3 §7, 02's attached acceptance hints |

- Adjudication: indistinguishable from the user's perspective governs; internal mechanisms (Chief prompt strategy, orchestration implementation) as black-box approximations do not count as failures (A4).

## 5. Notification-divergence acceptance criterion (A5, R1 final ruling)

- The in-app layer is **1:1**: the SSE `notification` events `plan_ready` / `build_review` (including scheduled rounds) / `chief_message`, the event shapes and the unread linkage (`GET /api/teams/{id}/notifications` → `{unreadThreadIds}` + badges) per 02 §9.1; no in-app events for done/failed, copied as-is.
- The desktop layer is a **divergence**: the in-page `new Notification()` (fired when `document.hidden`) honors the "when your tab moves to the background, remind you via desktop notifications" semantics; Web Push/VAPID/sw push delivery is not implemented. Three reasons (the #45 ruling record): ① browser push depends on hosts like FCM, unreachable in mainland environments — nominal parity that never actually arrives; ② the original site's push subscription itself got a 400 from the server (r5 §7.3 measured), so the desktop-popup column was broken on the original site to begin with; ③ SSE + in-page Notification covers the primary "background-tab reminder" semantics, and the all-browsers-closed scenario is beyond the web-only criterion.
- sw.js handling: under the byte-level carry-over obligation the push-handler code shape is kept, and the server produces no push messages (dead code tolerated, registered in this volume).
- Desktop-shell reservation: the native-notification path shape is kept (02 §9.1), outside the web-only acceptance scope.

## Appendix A · Remaining-evidence checklist (R4: no research tickets; verify on the spot when touched)

There are 44 [inferred] marks across the spec (volume 00: 2 / volume 01: 17 / volume 02: 25); the authoritative index = the 02 §11 table (the re-adjudication-trigger column). Items still untouched after r5:

| Item | Trigger condition | Verification action |
|---|---|---|
| memory read-side injection form | M4 memory implementation | observe injection traces against the Agent's execution transcript, write back to 02 §4.4 — **verified (M4b/#82)**: the replication-side injection form evidenced = claim `agent.memories[{title,content}]` → the systemPrompt `## 记忆` section (provider-wire request-body trace E2E assertion, integration m4b-memory-e2e); the official injection point still has no first-hand evidence, remaining [inferred]; written back to 02 §4.4/§11 |
| step-journal recover details | the M3 T2 time box | a self-set equivalent (shape match suffices, per 02 §11) |
| schedule kind enum words | M2 schedule implementation | replay todos.dev's wire to capture (capture if the environment exists; otherwise implement with the [inferred] words) |
| DELETE-verb surface | M2 endpoint implementation | capture likewise |
| search wire | does not fire | the self-set `GET /api/search` (02 §6.3), no parity obligation |
| preview-token / tunnel | see Appendix B | — |
| desktop-banner visuals | does not fire | dissolved with the R1 ruling (no comparison obligation under the divergence) |

Discipline: any verification producing a truth → write back to the 02 §11 status column + the corresponding ticket comment; the architecture is not changed unilaterally (02 §11 tail note).

## Appendix B · preview-token / tds-tunnel trigger conditions (the original map fog item's destination)

- Current state: recorded but undesigned in 02 §9.3; r3 §1.7's [inferred] purpose = task-branch dev-preview port forwarding (the tsnet stack); r5 additionally saw the task-branch file deep-link `files?ref=conv-…` touchpoint (belonging to 02 §3/A4's file surface).
- Graduate condition: at implementation time (M2+ or a web-line route ticket), a UI touchpoint (button/menu/deep link) or a wire touchpoint (an endpoint actually called by the frontend) is found → open a design ticket citing this appendix + r3 §1.7 + the r5 touchpoint record.
- Map #34 is closed; this appendix is the sole fog-item registry.

## Appendix C · the r7 §6 baseline-gap table and capture-division-of-labor (R6)

| Gap | Division of labor |
|---|---|
| the rejection-loop states / failure states / the `复用方案` popover / multi-row run history + rerun / the behavior after clicking the AI-review button | **completed (#64 / the r8 canon volume `r8-dynamic-states.md`, 54–77 landing in `assets/r8/`)**; the dark dynamic surfaces are still captured per web-implementation ticket |
| resource-page popup-form icons / dark popovers (more/token/branches/history/acceptance/delete) / the search-panel result state / the Chief drawer / the board-guide carousel | captured per web-implementation ticket along the way (statically reachable with a free account) |
| the detail three-scope icons JSON | replaced by a set-diff re-check (r7 §2), not re-captured |

**The r8-new-baseline referenceable-row list** (the matrix rows await the corresponding fixtures from web-implementation tickets; baselines use the `r8/…` prefix paths, already supported by run.mjs):

| r8 baseline | Candidate matrix rows (need fixtures) |
|---|---|
| `r8/54-失败态-详情-light.png` / `r8/73-失败态-探针详情-light.png` | detail-failed (failed phase + red row + changes pane) |
| `r8/55-失败态-看板卡片-light.png` | board-failed-card (the card chip `重试`) |
| `r8/56-失败态-重跑dialog-light.png` / `r8/74-重跑dialog-复用方案钮-light.png` | the rerun-dialog without/with-plan two variants (popover tickets must include open-state rows) |
| `r8/57-运行历史-失败态单行-light.png` / `r8/77-运行历史-多行-light.png` | the run-history single-row/multi-row open states |
| `r8/58-AI审核-弹层-light.png` | the ai-review-modal open state (the 560-width tier) |
| `r8/60-AI审核-审核结果-light.png` / `r8/61-AI审核后-状态-light.png` | the detail review-step streaming / auto-revision states |
| `r8/63-版本下拉-v2v1-light.png` / `r8/70-版本下拉-v3v2v1-light.png` | the version-dropdown open states |
| `r8/65-diff视图-v1v2-light.png` / `r8/66-diff展开-unified-light.png` / `r8/71-diff视图-v2v3-light.png` / `r8/72-diff展开-v2v3-light.png` | the plan-version-diff collapsed/expanded states |
| `r8/67-驳回-重规划streaming-light.png` / `r8/68-驳回-planv3时间线-light.png` | the detail rejection-loop streaming / v(N+1) awaiting-confirmation states |
| `r8/75-复用方案-子面板-light.png` / `r8/76-直接执行-复用方案时间线-light.png` | the reuse-plan sub-panel open state / the reuse-build first-line state |

Numbering discipline: from r8 onward, screenshots continue the r7 numbering (54+); never put caches in /tmp; assertion sources = screenshots/captures/daemon.log (the general research-ticket discipline). 78 is a single shot captured by #72 along the way (its ad-hoc volume was filed by #72 itself and had not entered this library when this volume was filed).

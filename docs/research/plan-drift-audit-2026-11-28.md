# Approved-plan drift audit — 2026-11-28

A person who just installed Cairn should still get the keyboard behavior and visible controls that were accepted when those surfaces shipped. A redesign can replace a control without replacing its keyboard behavior. This audit reads the plan, the current implementation and the intervening commits separately; a present test filename is not evidence that the original assertion survived.

**Baseline:** `02d0e6da241aa02d0090f100b97d71b8bd699bd0`, fetched `origin/main` at the start. Findings describe that SHA, not whatever is on main when this report is read. The plan parser found 465 `this change` edge rows in 42 plans, referring to 142 distinct proving-test paths; all 142 paths existed. The separate web UI audit has another eight rows marked `this change` (one with a parenthetical), and the legacy native-tray decision is included by request. The feature map has 57 rows. Explicit `later` rows are not shipped promises. Review PASS is not a later owner decision.

## Changes since the original promise

`Replaced` includes a changed policy or route that still serves the user need; `dropped` means the specific behavior has no equivalent at the baseline. A partial replacement only affects the part named here. The last column distinguishes direct owner intent, successor documentation and no evidence of either.

| Plan | Promised row | Status at baseline | Commit | Evidence | Later owner decision / disposition |
|---|---|---|---|---|---|
| [Native tray: normal and cold open](../design/native-tray-menu.md#L9) | AppKit Runner **and** keep-awake big buttons | replaced (awake only) | `efadf5557` | [Native mode rows](../../apps/desktop/src/native-tray.ts#L116), [Swift view renderer](../../apps/desktop/native/tray/core/TrayMenu.swift); `git log -S 'skeleton mode rows map to mode actions'` | [Owner picked task-scoped power modes](../design/keep-awake-modes.md#L3), not plain rows as the presentation. Reserved to `tray-awake-button`; no edits here. |
| [Run trace: hint and close](../design/run-trace.md#L67) | After opening the run log from the once-only hint and pressing Esc, keyboard focus returns to the spiral | dropped | `844b769fc` | `git show 844b769fc -- apps/web/e2e/run-trace.spec.ts` removes the exact `toBeFocused()` oracle while preserving the test filename; [hint is unmounted when used](../../apps/web/src/runs/run-log-button.tsx#L26) | No. The [owner chose an all-runs window](../design/run-log-window.md#L7), not loss of focus. Small restoration; retain the window, paging, filter and one-time hint. |
| [Run trace: navigation and positions](../design/run-trace.md#L65) | Spiral opens a problems-first turn popover; previous/next arrows; on narrow screens the popover fits; cursor refers to an existing turn | replaced | `844b769fc` | [Run page](../../apps/web/src/runs/run-page.tsx#L379), [run list](../../apps/web/src/runs/run-list.tsx#L124), [browser journey](../../apps/web/e2e/run-trace.spec.ts#L86); `git log -S 'RunTurnsTrigger'` | Yes. [Run-log window, direction 2](../design/run-log-window.md#L29): a list inside the window, all-runs scope and opt-in problems. Do not restore arrows/popover; failed-step jump, trace-only error filter and export remain. |
| [Runner token rotation: UI](../design/runner-token-rotation.md#L65) | Rotate with `R` or row menu; in-place confirmation and offline reauth drawer | replaced | `495e22dc8` | [Current Runner menu](../../apps/web/src/resources/machine-row.tsx#L237), [changed assertions](../../apps/web/e2e/machine-rotate-token.spec.ts#L125); `git log -S 'machine-menu-rotate-token' -- apps/web` | Yes. [Owner chose automatic rotation with no rotation UI](../design/settings-trim.md#L9). Explicit owner API remains; the automatic offline path does not invalidate the old token like the explicit API. |
| [Phone computer: empty/unpaired phone](../design/phone-computer.md) | Show the empty phone entry on the host row and offer pairing there | replaced (entry moved) | `91758639d` | `git log -S 'phone-add' -- apps/web/src`; [host row menu](../../apps/web/src/resources/machine-row.tsx#L237), [Add Runner dialog](../../apps/web/src/resources/create-machine-dialog.tsx#L477) | Original decision approved home-network pairing; no direct decision found on whether the empty slot should be visible. **Q1**. |
| [Keep-awake: skew/fallback](../design/keep-awake-modes.md#L35) | Reject an incompatible snapshot, keep the safe skeleton or fallback | replaced in part | `28c72654b` | [Tray parser and action setup](../../apps/desktop/src/native-tray.ts#L116), [old host compatibility test](../../apps/web/test/tray-native.test.ts#L302) | No direct owner decision found. Negotiated legacy switch and discard of invalid items in an otherwise usable snapshot are purposeful compatibility changes. **Q2**; do not touch tray implementation in this lane. |
| [Sign-in view: Copy/Open](../design/sign-in-view-and-toasts.md#L77) | The user copies on pressing Copy; Open opens the verification URL while waiting | holds for explicit controls; clipboard timing replaced | `c9455a1bf` | [Current browser assertions](../../apps/web/e2e/provider-device-sign-in.spec.ts#L122) still click Copy, and also assert copy on arrival and again on Open | [Later plan specifies both automatic paths](../design/chatgpt-provider-add.md#L9), with no direct later owner quote found. No missing control; record the additional side effect rather than restoring the old implementation. |
| [Sidebar account: pre-cloud footer](../design/in-app-cloud-account.md#L14) | Earlier generic brand footer | replaced | `ecff26831` | `git log -S 'sidebar-footer-brand' -- apps/web/src`; [account control](../../apps/web/src/board/sidebar-account.tsx) | Yes. [Owner asked for signed-in identity and an in-app account entry](../design/in-app-cloud-account.md#L12). No restore. The new plan's footer position claim is separate from the old brand. |
| [Task guidance: acceptance](../design/task-guidance-plan-2026-11-27.md#L3) | Every task is checked; do not add a visible acceptance status | replaced in part | `2b2a2c10c`, `7ea2f2667` | [Task row](../../apps/web/src/board/tasks-sections.ts#L96), [chat status row](../../apps/web/src/board/side-chat.tsx#L113), [non-code tests](../../apps/server/test/task-stall-needs-input.test.ts#L700) | Yes for [final answer and ready uploads as non-code delivery](../design/answer-only-done.md#L5). No separate owner ruling found for [showing the missing reason in the existing row](../design/done-in-prod.md#L46). No new stage/column. **Q3**. |
| [Coordinator reply speed: same-directory overlap](../design/coordinator-reply-speed.md#L38) | Cold run or wait while the directory is occupied; bounded wait for old process exit | replaced | `a264d11b5` | [ACP admission](../../apps/daemon/src/backend/acp.ts#L1189); active owner rejects, terminating owner waits up to four seconds; [ownership assertions](../../apps/daemon/test/antigravity-acp.test.ts#L1962) | Review/rebase hardening, not a substantiated owner policy change. **Q4**. Do not restore concurrent ownership of a directory to meet a latency number. |
| [Idle memory extraction](../design/idle-memory-extraction.md#L11) | Idle summary reuses the conversation route | replaced for idle only | `02d0e6da2` | `git log -S idleSummaryRoute`; [idle selector tests](../../apps/server/test/coordinator/idle-memory.test.ts#L150) | [Later routing plan](../design/idle-summary-routing.md#L7) explicitly allows HTTP summary routing for a subscription foreground, with skip/backoff when unavailable. Do not roll back; dedicated API is the documented contract. The old snapshot/session expiry was removed by the original retention change, not dropped afterwards. |
| [Auto-update: rollback](../design/auto-update.md) | Resident rollback after failed activation | replaced for unsafe rollback only | `9594c61d4` | [Compatibility/stop decision](../../apps/desktop/src/update-repair.ts#L111); [normal and hold tests](../../apps/desktop/scripts/background-update.test.ts#L668) | [Step roll-forward](../design/step-roll-forward.md#L11) explicitly keeps ordinary rollback and holds the incompatible previous writer. Restore neither unsafe fallback nor the deferred migration. |
| [Desktop release speed: overlap and single writer](../design/desktop-release-speed.md#L23) | Top-level lock is the release writer guard | replaced as a mechanism | `4816c4631`, `c3971016d` | [Workflow](../../.github/workflows/desktop-release.yml#L19), [replacement test](../../scripts/workflow-concurrency.test.mjs#L110); `git log -S 'serializes every wake' -- scripts/workflow-concurrency.test.mjs` | [Successor operating contract](../design/tested-sha-landing.md#L171) explains reservation and serialized final writers. Do not restore a single top-level lock; real release timing still needs separate evidence. |
| [HTML slides: generate the marked file](../design/html-slides-viewer.md) | Old info-card prompt (and normal worker prompt) teaches the HTML slide mark | replaced for info-card path | `d48c2bcf0` | [Current worker prompt](../../apps/daemon/src/step-prompt.ts#L162); old info-card execution tests deleted by path; historical readers remain | [Later retirement](../design/retire-info-card-pipeline.md) replaced info-card execution with scheduled Coordinator turns. Browser deck, comments, paging and Present remain. |
| [Daily mini eval: two starter cases](../design/eval-daily-mini.md#L66) | `fix-bug` and `rename-var` toy cases in the daily set | replaced | `8102a8ed8` | `git log -S 'rename-var' -- eval/lane-harness.test.ts`; [current positive/NOP assertions](../../eval/lane-harness.test.ts#L245) | Yes. `8102a8ed8` records owner approval to replace all ten toys. Original retirement of the weekly Actions workflow is not later drift. |
| [Eval results: published labels](../design/eval-public-results.md#L30) | Fixed replay/unrecorded model display names | replaced where model evidence exists | `338fe19b3` | [Label selector](../../scripts/ops/eval-public-results.mjs#L71), [cached compatibility](../../integration/test/site-search.test.ts#L457) | Yes: explicit owner follow-up in `338fe19b3`. Do not replace a recorded model label with a fallback. |
| [Real eval tasks: task matrix](../design/eval-real-tasks.md#L33) | Original `daemon-recover-outbox` lane task | replaced | `2280bff4b` | [Replacement task](../../eval/tasks/lane/run-trace-leading-blanks/task.json); the commit's retirement trailer gives the process-signal reason | Yes: owner-approved scorer isolation and task replacement recorded by that commit. No eval edits in this lane. |

### Questions to settle, without blocking the small fix

1. **Q1 — Phone pairing.** Keep pairing under the host menu and Add Runner, rather than restoring an empty phone block under every unpaired host? Recommend **yes**: both entry points can perform an action; the empty row consumed space on every host. Record it in the plan if confirmed.
2. **Q2 — Tray version skew.** Keep valid menu items on a mixed-version snapshot, falling back only when the menu cannot be used? Recommend **yes**: the old host keeps a usable menu; the unrelated big-button view belongs to `tray-awake-button`.
3. **Q3 — Acceptance copy.** May the existing task status line show the concrete missing evidence without adding a separate acceptance label? Recommend **yes**: it tells the user what needs action, and compliant non-code answers still finish straight away. This is narrower than adding a stage or an always-on status.
4. **Q4 — Concurrent ACP turns.** When two conversations target the same workspace, should the second wait for exclusive ownership with an explanation instead of failing immediately? Recommend **yes to a bounded wait, never parallel owners**. Keep the current exclusion until that concurrency policy is confirmed and covered; do not restore an unsafe cold start.

### Evidence holes are not later removals

- [Coordinator responsiveness](../design/coordinator-responsiveness.md#L65): current fake-clock silence/interjection assertions do not establish warm real-model TTFR ≤3 s or TTIR ≤5 s. No comparable cold/warm measurement found; not a confirmed deleted performance behavior.
- [Message search](../design/search-messages.md#L28): the bounded scan and visibility filters exist; [the query-plan oracle](../../apps/server/test/search-messages.test.ts#L422) explains a simpler SQL statement than the production statement. A hidden event starting before the scan window is an unproven boundary, not a reproduced leak or a proven later deletion.
- [Cloud account](../design/in-app-cloud-account.md#L53): the status endpoint strips a bad optional workspace URL and returns normal status, versus refusing bad payment redirects. [Tests](../../apps/server/test/cloud-account.test.ts#L143) show that distinction existed at landing. Do not regress payment safety to reconcile plan prose. Actual third-party sign-in, billing and migration were not exercised here.
- [Answer-only Done](../design/answer-only-done.md#L21): the ready attachment query currently sits behind an assistant-message guard in [completion](../../apps/server/src/services/build-step-complete.ts#L187). No proof was found that the successful no-assistant-row state is reachable; current tests do not settle it.
- [Step roll-forward](../design/step-roll-forward.md#L33): the actual additive DB migration, old unchanged installer rehearsal and hardware lid assertions in [keep-awake](../design/keep-awake-modes.md#L53) are not established by fixture tests. Deferred items are not missing shipped rows.

## Feature map: routes, reachable controls, and shortcuts

`node scripts/generate-feature-map.mjs --check` passed all 57 registry rows at the baseline. It finds definitions in source; it cannot guarantee a route renders after the first-run gate, that a locator is actionable, or that the documented steps seed the state. The isolated live stack rendered a fresh `/app` and `/tray`; it also navigated static map paths (recording redirects), but most settings content behind first-run was checked with fixtures, not with real configured providers. Dynamic IDs and stateful recipes not covered by the fixtures below remain runtime gaps.

| Feature map row | Status | Evidence / correction |
|---|---|---|
| `selection-reply` | Reach steps incomplete | Hovering `chief-reply` is not enough to create `selection-quote`. The [passing fixture journey](../../apps/web/e2e/chief-selection-quote.spec.ts#L36) selects text first, then presses `R`; Enter stages and Cmd+Enter sends. This is a stale/incomplete recipe, not a missing quote control. |
| `coordinator-context` | Old trigger no longer actionable | `chief-earlier` is a [history container](../../apps/web/src/chief/chief-conversation.tsx#L794), not a button. Earlier history is loaded by the scroll loader below the scroller in the same component. The click was present in the original registry (`197b0321e`); source history under `apps/web/src/chief` includes `1bc150340` and `ea620cf40`. Recipe should say to seed a long history and scroll to its start; do not restore a dead click target. |
| `desktop-app` | Status and coverage stale | The registry calls it `planned` and only lists `/tray`. Live `/tray` is the fallback view; AppKit is a real additional surface in [native tray](../design/native-tray-menu.md). `c31d137a2` added it. A browser `/tray` screenshot does not certify AppKit. |
| `schedules` | Holds as compatibility route, not standalone page | Live `/app/schedules` resolved to `/app`; [the redirect opens Tasks/Schedules](../../apps/web/src/App.tsx#L81) on configured accounts. `3befcc04d` removed the standalone page. `sidebar-schedules` and `schedule-new` still exist; the registry's description already names the Tasks panel. |
| `app-shell`, `routing`, `providers`, `machines`, `account-and-team`, `skills`, `api-keys`, `mcp-servers`, `secrets` | Canonical settings and compatibility routes present | Scoped fixture [settings](../../apps/web/e2e/settings-window.spec.ts#L100) passed link redirects/search and mobile switching. Live legacy routing/provider/machines/skills/MCP/secrets/API key/account paths redirected to the appropriate `/app/settings/<section>`; first-run masked underlying content. |
| `coordinator-chat`, `search`, `first-run`, `sidebar`, `run-log` | Holds for exercised states, except run-log focus above | Fixture [chat](../../apps/web/e2e/chief-home-chat.spec.ts#L152) and [hotkeys](../../apps/web/e2e/hotkeys.spec.ts#L43) exercised Cmd+J; [message search](../../apps/web/e2e/search-messages.spec.ts#L84) exercised search and keyboard result activation, hotkeys verified the Mod+K hint. [Setup](../../apps/web/e2e/first-run-setup.spec.ts#L187) proves the confirm which is not visible before choosing a provider; [status prompt](../../apps/web/e2e/first-run-checklist.spec.ts#L80) and [sidebar](../../apps/web/e2e/sidebar-nav.spec.ts#L34) journeys render. Run-log button opens a window, not the retired popover. |
| Remaining map rows | Static checked; runtime only where linked to a named passing journey | The other provider, task, desktop and integration states cannot be inferred from a source test-id, successful initial page load, or a route's 200 HTML fallback. No production mutations were needed for the audit. |

## Preventing recurrence

Propose extending [the existing test-integrity gate](../../scripts/test-integrity-gate.mjs#L61), not adding a new CI job. For each candidate commit, take deleted paths and renames from the *parent-to-commit* diff. Only when that set intersects runnable tests referenced by `this change`, parse the **parent** plan with [the canonical parser](../../scripts/plan-spec.mjs#L142). Require an update to each affected plan row, or a checked-in successor decision with an explicit old plan/row link and what replaces it. A bare `test-removal-reason` or `Plan:` trailer for an unrelated plan must not bypass this check; a whitespace-only edit or pointing to an empty/absent test must also fail. Rename plus a plan reference update can pass; later/deferred rows and tests not owned by any plan are not new violations. Reuse the existing test-integrity logic for general file deletions.

Whole-file deletion is the inexpensive first step, but **it would not have stopped either of the motivating UI cases by itself**: key assertions changed in place in `smoke-mac.mjs` and `run-trace.spec.ts`. For stable UI contracts, identify the proving case inside shared files (e.g. a named test/case plus required user action or outcome), and cover removal of that assertion with an explicit negative case. Start with the focus regression and old tray interaction, not a line-count heuristic over every edited assertion. A real regression test is higher value than a new gate that only sees file names.

Status: proposal only. Turning on a blocking gate is a new mechanism (Medium); it first needs nonblocking replay, a ratchet for pre-existing orphaned/legacy references, zero unintended blocks on recent main, negative controls using `efadf5557` and `844b769fc`, legitimate replacement controls (`495e22dc8`), and measured incremental runtime. None of those conditions is claimed by this report. Use the existing `--commit` entry point for the replay; add no CI scheduler or landing change.

## Test scope and process

- Audit/report: **Small**, facts-only; no new mechanism or plan review. Read implementation and proving tests at the pin; used `git log -S` for deleted controls and `git log -- <path>` for rewrites, and looked for successor plan/owner decisions. Findings without enough evidence are explicitly open, not treated as permissions to rewrite the product.
- Runtime baseline: Mac mini, `mini-test` + `verify-cairn` isolated live stack; no real provider exercised. `/app` rendered two-step first run, `/tray` rendered Runner and three awake mode rows. The screenshots are in the mini's private audit evidence directory `plan-drift-audit-02d0e6da2` (`app.png`, `tray.png`), not committed. The former is not an authenticated production walk and the latter is not the native AppKit view. The AppKit fixture (`node --test apps/desktop/scripts/tray-helper.test.mjs`, on the mini) did not instantiate a menu: the mini's Swift CLT fails during compilation with duplicate `SwiftBridging` module definitions. Native render remains unverified in this audit.
- Fixture baseline: Mac mini Playwright over the baseline fixture build; 197 passed, three `chief-copy-as-markdown` cases reached a host-specific screenshot directory and failed with `EACCES`. A focused retry of those three with `CI=1` (no laptop screenshot path) passed. The second broader batch timed out before a final summary. Passing suites in the first batch include Coordinator chat/quote/selection, multi-tab streams, search messages, sidebar nav, Settings window/restore, first-run setup/checklist, tray's chat indicators, desktop update, account controls, subscription quota/Claude subscription, IM settings, HTML slides, run trace, browser notification, Runner menu and hotkeys. A rendered control in one fixture does not establish adjacent branches, native behavior, external services or real device tests.
- Repair for lost focus: **Small**, restoring one specified keyboard behavior with no layout, wire, auth, persistence or scheduling change. No new plan or Pi review. The restored assertion failed on `02d0e6da2`: after Esc the spiral was not focused. The fix gives focus to the surviving spiral before retiring the hint and lets the existing dialog restore it; the full run-trace spec passed on the mini (13 tests), including keyboard opening, close button, and unaffected direct and failure-link entry points. No layout or other behavior changed. The first preflight attempt stopped before tests because the worktree lacked its `yaml` dependency; the second stopped at static regression inversion because that gate cannot run browser specs on the parent. Added a [component regression](../../apps/web/test/run-log-button.test.ts) that calls the same hint handler and checks focus before retirement and navigation. It was red with the old handler and green with the fix; the browser spec still proves the real dialog and keyboard behavior. Queue and a production keyboard walk are required before calling the repair delivered.

## Plan coverage index

The index below enumerates the original rows and their named proving paths. It is a cross-reference for the verdicts and evidence above, not a statement that every named test ran or proves every clause. Where a status is not established by the evidence in this report, the index says `—` rather than guessing `holds`.

<details>
<summary>agent-passages — 14 rows</summary>

Baseline anchors: [routes-chief.ts](../../apps/server/src/routes-chief.ts), [machine-claim-payload.ts:257](../../apps/server/src/services/machine-claim-payload.ts#L257).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [25](../design/agent-passages.md#L25) | Healthy team with connected local Mac (`ownComputerShell`, `ownComputer`, Accessibility granted), connected cached HTTP MCP connector, and main `chiefThread` | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [26](../design/agent-passages.md#L26) | `connected` HTTP MCP connector whose `toolsJson` is still `null` (unhydrated cache) with no other cached connectors or active IMAP mail accounts | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [27](../design/agent-passages.md#L27) | Diagnostics evaluated when offered tools omit router tools (`buildCoordinatorDiagnostics(..., { routerTools: false })`) | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [28](../design/agent-passages.md#L28) | Local Mac disconnected/offline after runner restart (`machineHub.isConnected === false`) while machine row remains enrolled | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [29](../design/agent-passages.md#L29) | Local Mac connected with `ownComputer: true` only (`ownComputerShell` unset) and macOS Accessibility not granted | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [30](../design/agent-passages.md#L30) | Local Mac connected with `ownComputerShell: true` only (`ownComputer` unset) | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [31](../design/agent-passages.md#L31) | Consented connected phone (including pairing in flight) vs unconsented/disconnected phone, and browser `takeover` / `stealth` / `ownerChrome` flags | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [32](../design/agent-passages.md#L32) | Omitted `threadId` query parameter with project/digest/memory/other-user threads, or zero threads | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [33](../design/agent-passages.md#L33) | Explicit `threadId` naming a side thread (`chief-memory-*` or `chief-digest-*`), nonexistent thread, or another team's thread | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [34](../design/agent-passages.md#L34) | Requested `threadId` belongs to a non-owner user on the team | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [35](../design/agent-passages.md#L35) | Unknown team `:id` on `GET /api/teams/:id/chief/diagnostics` | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [36](../design/agent-passages.md#L36) | Missing or unreadable `deployRecordPath` and null `machine.capabilities` | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [37](../design/agent-passages.md#L37) | Team has more than 5 failed steps across `build` (including restarted build with cleared `errorMessage`) and `chief` turns (with and without `chief-err-*` row), plus another team's failures | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |
| [38](../design/agent-passages.md#L38) | Refactored `machine-claim.ts` and `coordinator/index.ts` remote tool assembly (`mailTurn`, `memoryEditTurn`, `SUGGEST_REPLIES_TOOL_NAME`, `CORE_COORDINATOR_TOOLS`, `routerTools`) | [coordinator-diagnostics.test.ts](../../apps/server/test/coordinator-diagnostics.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>answer-only-done — 5 rows</summary>

Baseline anchors: [acceptance.ts:430](../../packages/shared/src/records/acceptance.ts#L430), [build-step-complete.ts:187](../../apps/server/src/services/build-step-complete.ts#L187).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [25](../design/answer-only-done.md#L25) | Answer-only text or command task provides a final answer with no commit | [task-stall-needs-input.test.ts](../../apps/server/test/task-stall-needs-input.test.ts) | — (indexed source/test only) |
| [26](../design/answer-only-done.md#L26) | Code task has no change, including a change request that only reports | [task-stall-needs-input.test.ts](../../apps/server/test/task-stall-needs-input.test.ts) | — (indexed source/test only) |
| [27](../design/answer-only-done.md#L27) | Non-code task uploads a standalone deck and successfully ends | [task-stall-needs-input.test.ts](../../apps/server/test/task-stall-needs-input.test.ts) | — (indexed source/test only) |
| [28](../design/answer-only-done.md#L28) | Worker fails, stops, asks, owes delivery of a question answer, or no upload qualifies for Done | [task-stall-needs-input.test.ts](../../apps/server/test/task-stall-needs-input.test.ts) | — (indexed source/test only) |
| [29](../design/answer-only-done.md#L29) | No ready worker attachment, and an info task has an empty, earlier-step, tool-only or failed-command reply, edits, a file-upload call, a legacy separate deliverable or no confirmed `hasChanges: false` | [task-stall-needs-input.test.ts](../../apps/server/test/task-stall-needs-input.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>auto-update — 10 rows</summary>

Baseline anchors: [background-update.ts:229](../../apps/desktop/src/background-update.ts#L229), [update-repair.ts:111](../../apps/desktop/src/update-repair.ts#L111).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [88](../design/auto-update.md#L88) | Server release watcher discovers newer release on `DESKTOP_MANIFEST_URL` (`supported: true` vs `supported: false` vs `blocked` / rollback vs offline) | [release-watcher.test.ts](../../apps/server/test/release-watcher.test.ts) | — (indexed source/test only) |
| [89](../design/auto-update.md#L89) | `GET /api/server/version` v1 vs `?schema=2`, manual `force: true` retry on blocked version, and `POST /api/machine/presence` `update.targetVersion` | [server-version.test.ts](../../apps/server/test/server-version.test.ts) | — (indexed source/test only) |
| [90](../design/auto-update.md#L90) | Headless resident server acquires `deploy_lease`, snapshots DB, fails closed on probe/auth error, confirms 30s sustained health, coordinates `guardOwner`/`guardPid` without GUI race, reconciles leftover `state.installed`, and restores `.cairn-previous` in `RUN_OR_REMOVE` | [background-update.test.ts](../../apps/desktop/scripts/background-update.test.ts) | — (indexed source/test only) |
| [91](../design/auto-update.md#L91) | Headless resident server crashes or fails 3 health probes after DB migration (untouched DB vs post-snapshot domain writes), or double-faults on rollback (`rollback-failed`) | [background-update.test.ts](../../apps/desktop/scripts/background-update.test.ts) | replaced in part (`9594c61d4`) |
| [92](../design/auto-update.md#L92) | Remote laptop connected to newer server or seeing newer `latestRelease` (`?schema=2` vs v1 server fallback), host switch cancellation, `force: true` retry, and remote rollback notice | [remote-version.test.ts](../../apps/desktop/scripts/remote-version.test.ts) | — (indexed source/test only) |
| [93](../design/auto-update.md#L93) | Standalone Runner install classification (`desktop-bundled`, `homebrew`, `docker`, `development`, `read-only` vs writable `npm i -g` / archive) and manual base-binary upgrade override | [self-update.test.ts](../../apps/daemon/test/self-update.test.ts) | — (indexed source/test only) |
| [94](../design/auto-update.md#L94) | Standalone Runner artifact validation (`runner-latest.json` missing arch / 404 / corrupt SHA-256 / path escape / smoke-test fail / 30-min backoff) and active-work drain (active step, `computer`/`screen`, ignoring exhausted stranded uploads, 30-min drain cap) | [self-update.test.ts](../../apps/daemon/test/self-update.test.ts) | — (indexed source/test only) |
| [95](../design/auto-update.md#L95) | Standalone Runner thin launcher exit `75` hot-swap, `booted` vs 30s `confirmed` `attemptId` probation, crash rollback vs server-outage patience, `SIGTERM` clean stop, and double-fault fallback | [self-update.test.ts](../../apps/daemon/test/self-update.test.ts) | — (indexed source/test only) |
| [96](../design/auto-update.md#L96) | Runners row and Remote update bar single-line presentation across updating, waiting-idle, rolled-back, read-only manual states, and `RemoteUpdateBar` vs `preload.ts` priority | [machine-row-update.test.ts](../../apps/web/test/machine-row-update.test.ts), [remote-version.test.ts](../../apps/web/test/remote-version.test.ts) | — (indexed source/test only) |
| [97](../design/auto-update.md#L97) | `release-manifest.mjs` preserves strict `desktop-latest.json` schema and writes sibling `runner-latest.json` when Runner archives exist | [desktop-release.test.mjs](../../scripts/desktop-release.test.mjs) | — (indexed source/test only) |

</details>

<details>
<summary>chatgpt-provider-add — 7 rows</summary>

Baseline anchors: [add-provider-flow.tsx:283](../../apps/web/src/resources/add-provider-flow.tsx#L283), [codex-device-login.test.ts:89](../../apps/server/test/codex-device-login.test.ts#L89).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [23](../design/chatgpt-provider-add.md#L23) | Code arrives, Open login clicked after clipboard changed, automatic write refused, offline/poll timeout, restart/cancel | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [24](../design/chatgpt-provider-add.md#L24) | Device add completes, replaces an existing credential, fails or is cancelled | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [25](../design/chatgpt-provider-add.md#L25) | ChatGPT catalog requires account routing and returns Codex slugs and visibility, not API model IDs | [codex-device-login.test.ts](../../apps/server/test/codex-device-login.test.ts) | — (indexed source/test only) |
| [26](../design/chatgpt-provider-add.md#L26) | Initial failure / slow fetch / retry; another subscription | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [27](../design/chatgpt-provider-add.md#L27) | Provider not removed / confirmed remove | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [28](../design/chatgpt-provider-add.md#L28) | OAuth redirects back, with or without a saved provider | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [29](../design/chatgpt-provider-add.md#L29) | Doubao QR row saved, scan dismissed | [providers-doubao-subscription.spec.ts](../../apps/web/e2e/providers-doubao-subscription.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>claim-split — 6 rows</summary>

Baseline anchors: [machine-claim-payload.ts](../../apps/server/src/services/machine-claim-payload.ts), [machine-claim.ts:553](../../apps/server/src/services/machine-claim.ts#L553).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [61](../design/claim-split.md#L61) | Versioned v1 payload round-trip, unversioned legacy fallback (`1`), and unsupported `payloadVersion` (`2`, `0`, `'1'`) rejection | [claim-payload.test.ts](../../packages/shared/test/claim-payload.test.ts) | — (indexed source/test only) |
| [62](../design/claim-split.md#L62) | Frozen pre-v1 schema strips `payloadVersion` and real HTTP `POST /api/machine/tasks/claim` emits `payloadVersion: 1` for worker & chief and finishes through heartbeat/token/done | [claim-payload.test.ts](../../packages/shared/test/claim-payload.test.ts), [machine-claim-split.test.ts](../../apps/server/test/machine-claim-split.test.ts) | — (indexed source/test only) |
| [63](../design/claim-split.md#L63) | Chief claim freezes `mcpGrant` before async attachment staging and fences `memoryTrace` updates by `claimedAt` | [machine-claim-split.test.ts](../../apps/server/test/machine-claim-split.test.ts) | — (indexed source/test only) |
| [64](../design/claim-split.md#L64) | `heartbeatStep` refreshes `lastHeartbeatAt`, throws `410` on deleted step, and throws `NotFoundError` (`404`) on unowned/released step | [machine-claim-split.test.ts](../../apps/server/test/machine-claim-split.test.ts) | — (indexed source/test only) |
| [65](../design/claim-split.md#L65) | `releaseStepLease` CAS fence on `(status='claimed', expectedMachineId, expectedClaimedAt)` (including `expectedMachineId: null`), preserves `claimedAt`, and sweeps skip publish/wake/question-cancel when CAS misses | [machine-claim-split.test.ts](../../apps/server/test/machine-claim-split.test.ts) | — (indexed source/test only) |
| [66](../design/claim-split.md#L66) | Abandoned worker & chief sweeps release via `releaseStepLease`, quarantine at limit, and module boundaries remain cycle-free with identical `machines` / `machine-claim` facade exports | [machine-claim-split.test.ts](../../apps/server/test/machine-claim-split.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>codebase-maintainer-prompt — 6 rows</summary>

Baseline anchors: [prompts.ts:230](../../packages/shared/src/records/prompts.ts#L230), [step-prompt.ts:162](../../apps/daemon/src/step-prompt.ts#L162).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [21](../design/codebase-maintainer-prompt.md#L21) | Coding task (`plan`/`build`/`session`, `output` `'code'` or omitted) on `claude-code`, `pi`, `devin`, `antigravity`, `gemini` | [codebase-maintainer-prompt.test.ts](../../apps/daemon/test/codebase-maintainer-prompt.test.ts) | — (indexed source/test only) |
| [22](../design/codebase-maintainer-prompt.md#L22) | Non-coding steps (`review`, `verify`, `merge`, `chief`), missing `todo`, or `info`/`report`/`dataset`/`link` tasks | [codebase-maintainer-prompt.test.ts](../../apps/daemon/test/codebase-maintainer-prompt.test.ts) | — (indexed source/test only) |
| [23](../design/codebase-maintainer-prompt.md#L23) | Empty agent description and no memories (`description: null`, `memories: undefined`) on a coding task | [codebase-maintainer-prompt.test.ts](../../apps/daemon/test/codebase-maintainer-prompt.test.ts) | — (indexed source/test only) |
| [24](../design/codebase-maintainer-prompt.md#L24) | Antigravity continuation vs fresh-session fallback (`continueSession` vs `SessionNotResumableError`) | [codebase-maintainer-prompt.test.ts](../../apps/daemon/test/codebase-maintainer-prompt.test.ts) | — (indexed source/test only) |
| [25](../design/codebase-maintainer-prompt.md#L25) | Session failure paths (Pi prefix-mismatch recovery vs persistent 400; `resume.prompt === null` crash recovery; legacy brief marker in cwd) | [codebase-maintainer-prompt.test.ts](../../apps/daemon/test/codebase-maintainer-prompt.test.ts) | — (indexed source/test only) |
| [26](../design/codebase-maintainer-prompt.md#L26) | Transcript origin backfill on unmigrated vs migrated DBs for literal legacy and updated `SESSION_BRIEF` (standalone & `\n\n<restart>`) | [session-brief-maintainer.test.ts](../../apps/server/test/session-brief-maintainer.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>coordinator-normal-permissions — 8 rows</summary>

Baseline anchors: [antigravity-hooks.ts](../../apps/daemon/src/backend/antigravity-hooks.ts), [agent-turn.ts](../../packages/shared/src/agent-turn.ts).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [30](../design/coordinator-normal-permissions.md#L30) | Normal Antigravity Coordinator turn running `run_command` and reading a file; also non-zero exit / missing command / timeout / cancel | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts) | — (indexed source/test only) |
| [31](../design/coordinator-normal-permissions.md#L31) | Normal Claude Code (SDK + ACP), Devin, and Gemini Coordinator turns | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts), [step-session-opts.test.ts](../../apps/daemon/test/step-session-opts.test.ts) | — (indexed source/test only) |
| [32](../design/coordinator-normal-permissions.md#L32) | Pi daemon Coordinator parity and in-server Doubao routing (`serverTakesTurn` with/without `CAIRN_OWN_COMPUTER=1`) | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts) | — (indexed source/test only) |
| [33](../design/coordinator-normal-permissions.md#L33) | Session resume and `normal -> relay-only (mail) -> normal` switching in reused thread `cwd` and isolated `HOME` | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts) | — (indexed source/test only) |
| [34](../design/coordinator-normal-permissions.md#L34) | Concurrent restricted leases in same `cwd` (out-of-order exit, startup error cleanup, concurrent user hook edit, and normal turn while restricted lease is active) | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts) | — (indexed source/test only) |
| [35](../design/coordinator-normal-permissions.md#L35) | Stale `cairn-relay-guard` cleanup and `hooks.json` file edges (missing file, user-only hooks, user empty `{}` / pre-existing `.agents` dir, corrupt non-JSON on normal vs restricted turn, read/write error, user hooks + stale guard, stale guard only) | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts) | — (indexed source/test only) |
| [36](../design/coordinator-normal-permissions.md#L36) | Preserved narrow protections (`remoteToolsOnly: true` mail/memory-edit turns, `isReview: true`, `ws.readonly`, daemon read-only subagent under unlocked parent) | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts), [step-session-opts.test.ts](../../apps/daemon/test/step-session-opts.test.ts) | — (indexed source/test only) |
| [37](../design/coordinator-normal-permissions.md#L37) | Main vs project channel, runner offline/other runner selected, and in-server Doubao (`serverTakesTurn` with/without `CAIRN_OWN_COMPUTER=1`) | [coordinator-normal-permissions.test.ts](../../apps/daemon/test/coordinator-normal-permissions.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>coordinator-reply-speed — 9 rows</summary>

Baseline anchors: [acp.ts:877](../../apps/daemon/src/backend/acp.ts#L877), [acp.ts:1189](../../apps/daemon/src/backend/acp.ts#L1189).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [42](../design/coordinator-reply-speed.md#L42) | Warm hit across consecutive turns (`sessionId`, `modelId`, `thinkingLevel`, `policy`, tools, auth match) | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [43](../design/coordinator-reply-speed.md#L43) | Stray MCP tool call, late ACP notification, or permission request while parked; or in-flight tool at `end_turn` | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [44](../design/coordinator-reply-speed.md#L44) | First message ever (`createSession`) or `freshSession` / compaction rotation (`createSession` on same `cwd`) | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [45](../design/coordinator-reply-speed.md#L45) | Compatibility mismatch (`modelId`, `thinkingLevel`, `policy`, `lockedDown`, `toolDigest`, `externalMcpDigest`, `authKey`) | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [46](../design/coordinator-reply-speed.md#L46) | Turn `stop()`, error, OAuth expiry while parked (`-32000`), unsupported image on warm turn, idle child exit, or spawn/retain failure | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [47](../design/coordinator-reply-speed.md#L47) | Idle TTL (`warmSessionIdleMs`), LRU cap (`MAX_WARM_SESSIONS = 2`), and `backend.close()` (binary swap / daemon shutdown) | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [48](../design/coordinator-reply-speed.md#L48) | Per-step `CAIRN_STEP_TREE` (`StepReaper`) and per-step `TMPDIR` cleanup after Turn 1 | [antigravity-acp.test.ts](../../apps/daemon/test/antigravity-acp.test.ts) | — (indexed source/test only) |
| [49](../design/coordinator-reply-speed.md#L49) | Cross-machine claim (`antigravity` on `machine-a` → `machine-b`; same-machine resume; null `machineId`; unrelated step `sessionId`; A→B→A; locked turn without `chief.history`; empty history; `pi` cross-machine) | [chief-claim-session-machine.test.ts](../../apps/server/test/chief-claim-session-machine.test.ts) | — (indexed source/test only) |
| [50](../design/coordinator-reply-speed.md#L50) | `DeltaRelay` `leading: true` first push, burst coalesce, post-window push, `flushNow()` serialization behind in-flight leading send, `discard()` on Stop/retry, leading send failure, thinking-only | [delta-relay.test.ts](../../apps/daemon/test/delta-relay.test.ts), [step-pass-controls.test.ts](../../apps/daemon/test/step-pass-controls.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>coordinator-responsiveness — 14 rows</summary>

Baseline anchors: [responsiveness.ts:259](../../apps/server/src/coordinator/runtime/responsiveness.ts#L259), [turn.ts:423](../../apps/server/src/coordinator/runtime/turn.ts#L423), [chief-conversation.tsx:391](../../apps/web/src/chief/chief-conversation.tsx#L391).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [64](../design/coordinator-responsiveness.md#L64) | Simple question requiring no tools | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [65](../design/coordinator-responsiveness.md#L65) | Slow model TTFT / cold prompt cache vs warm cache | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (no real-model timing evidence) |
| [66](../design/coordinator-responsiveness.md#L66) | Lookup turn emitting Round 1 ack + Round 2 answer with shared prefix | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [67](../design/coordinator-responsiveness.md#L67) | Mid-turn `notify_user` in user turn: two identical messages across distinct `toolCallId`s vs same-`toolCallId` replay | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [68](../design/coordinator-responsiveness.md#L68) | Mid-work interjection during tool round (`cancel`, `replace`, or `side-question`) | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [69](../design/coordinator-responsiveness.md#L69) | Post-ack correction (`M1` acked then `M2` "I misspoke earlier"), Round 2+ streaming interjection, conflicting rapid steers, and user steer into active non-mail `[wake:…]` event turn | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [70](../design/coordinator-responsiveness.md#L70) | Long tool / slow non-subagent tail / explicit `subagent` `timeoutSec: 300` vs barge-in (`turn.ts:265`) / failed `notify_user` | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [71](../design/coordinator-responsiveness.md#L71) | Silence guard trigger at 4 silent tool calls or >= 12 s elapsed | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [72](../design/coordinator-responsiveness.md#L72) | Prompt-cache prefix byte invariance across rounds, warm cross-turns, epoch expiry & compaction | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [73](../design/coordinator-responsiveness.md#L73) | Event turn (`[wake:…]` with no user steer) & legacy Runner `notify_user` without `toolCallId` | [responsiveness.test.ts](../../apps/server/test/coordinator/responsiveness.test.ts) | — (indexed source/test only) |
| [74](../design/coordinator-responsiveness.md#L74) | Multi-bubble `liveTextStore` handoffs (`m1` then `m2`, `m2` before `m1`, duplicate `noteSettled`, terminal step in Round 2, SSE reconnect) | [chief-stream-handoff.test.ts](../../apps/web/test/chief-stream-handoff.test.ts) | — (indexed source/test only) |
| [75](../design/coordinator-responsiveness.md#L75) | Pressing `Enter` while turn streams + stateful stale-prop re-render + failed-send restore + upload-in-flight / `useServerDraft.refresh()` | [composer-queue-stop.test.ts](../../apps/web/test/composer-queue-stop.test.ts) | — (indexed source/test only) |
| [76](../design/coordinator-responsiveness.md#L76) | Async composer caller where M2 is typed before M1 resolves | [composer-queue-stop.test.ts](../../apps/web/test/composer-queue-stop.test.ts) | — (indexed source/test only) |
| [77](../design/coordinator-responsiveness.md#L77) | Rapid typing with live SSE `text_delta`/`activity` ticks in busy Coordinator chat | [chief-home-busy.spec.ts](../../apps/web/e2e/chief-home-busy.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>desktop-release-speed — 5 rows</summary>

Baseline anchors: [desktop-release.yml:19](../../.github/workflows/desktop-release.yml#L19), [release-reservation.mjs:15](../../scripts/ops/release-reservation.mjs#L15).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [23](../design/desktop-release-speed.md#L23) | Manual/scheduled duplicate, queued/waiting owner, owner API failure, orphan or reservation failure, rerun | [release-gate.test.mjs](../../scripts/ops/release-gate.test.mjs) | — (indexed source/test only) |
| [24](../design/desktop-release-speed.md#L24) | Descendant arrives during an older build; finalizers arrive in reverse order or wait on the lock; late-green older SHA gets a higher version | [release-gate.test.mjs](../../scripts/ops/release-gate.test.mjs), [desktop-release.test.mjs](../../scripts/desktop-release.test.mjs) | — (indexed source/test only) |
| [25](../design/desktop-release-speed.md#L25) | Migration baseline unchanged/advanced/missing, third-party change during upload; red package/verify | [release-gate.test.mjs](../../scripts/ops/release-gate.test.mjs), [desktop-release.test.mjs](../../scripts/desktop-release.test.mjs) | — (indexed source/test only) |
| [26](../design/desktop-release-speed.md#L26) | Reservation marker edited, occupied tag, partial upload, moved main, CI rerun or failed REST read | [desktop-release.test.mjs](../../scripts/desktop-release.test.mjs) | — (indexed source/test only) |
| [27](../design/desktop-release-speed.md#L27) | ZIP archive compressor changes | [desktop-release.test.mjs](../../scripts/desktop-release.test.mjs) | — (indexed source/test only) |

</details>

<details>
<summary>done-in-prod — 8 rows</summary>

Baseline anchors: [acceptance.ts:156](../../packages/shared/src/records/acceptance.ts#L156), [tasks-sections.ts:96](../../apps/web/src/board/tasks-sections.ts#L96).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [68](../design/done-in-prod.md#L68) | UI edit attaching a screenshot with zero post-edit execution, or 0-byte / `sizeBytes: undefined` upload | [done-in-prod-acceptance.test.ts](../../packages/shared/test/done-in-prod-acceptance.test.ts) | — (indexed source/test only) |
| [69](../design/done-in-prod.md#L69) | Non-health API edit probed only via `/health` + `health.json`, observed `deployedSha` mismatches `expectedCommit`, remote URL probe or prod claim without observing `expectedCommit`, or post-edit output with `HTTP/1.1 500` / `AssertionError` | [done-in-prod-acceptance.test.ts](../../packages/shared/test/done-in-prod-acceptance.test.ts) | — (indexed source/test only) |
| [70](../design/done-in-prod.md#L70) | CLI/script/general code (`packages/shared/src/...`) edit without attachment, same-ms pre-edit upload (`idx <= lastEditIdx`), or mixed UI+API partial proof vs `docOnly` read-back | [done-in-prod-acceptance.test.ts](../../packages/shared/test/done-in-prod-acceptance.test.ts) | — (indexed source/test only) |
| [71](../design/done-in-prod.md#L71) | `parseMissingEvidenceLine` + updated `SESSION_BRIEF` / `SESSION_REWORK_BRIEF` + archived `LEGACY_*` | [done-in-prod-acceptance.test.ts](../../packages/shared/test/done-in-prod-acceptance.test.ts) | — (indexed source/test only) |
| [72](../design/done-in-prod.md#L72) | Live SSE push on nudge (`building`), `missingEvidence` projection on `GET /api/todos` & `GET /api/tasks` in `building`/`needs_input`, cleared on `done`, `reportLine` untouched | [done-in-prod.test.ts](../../apps/server/test/done-in-prod.test.ts) | — (indexed source/test only) |
| [73](../design/done-in-prod.md#L73) | Attempt isolation: prior `plan` step, earlier rework round, other todo, `deliverable` scope, or 0-byte attachment vs `attachWorkerFile` upload | [done-in-prod.test.ts](../../apps/server/test/done-in-prod.test.ts) | — (indexed source/test only) |
| [74](../design/done-in-prod.md#L74) | Stall monitor (#19) on acceptance-retry step: 1st silence requeues with `missingEvidence`, 2nd silence stays `claimed` with deduped alert naming what is missing, plus `LEGACY_SESSION_BRIEFS` backfill `synthetic` | [done-in-prod.test.ts](../../apps/server/test/done-in-prod.test.ts) | — (indexed source/test only) |
| [75](../design/done-in-prod.md#L75) | Web UI `toDisplayTodo`, `taskRowCopy`, `statusLineMeta`, and `EN` translation for `missingEvidence` | [done-in-prod-ui.test.ts](../../apps/web/test/done-in-prod-ui.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>doubao-runtime — 12 rows</summary>

Baseline anchors: [doubao-managed.ts](../../apps/daemon/src/backend/doubao-managed.ts), [add-provider-flow.tsx:283](../../apps/web/src/resources/add-provider-flow.tsx#L283).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [83](../design/doubao-runtime.md#L83) | Personal subscription ToS compliance risk for unattended background tasks | [doubao-claim.test.ts](../../apps/server/test/doubao-claim.test.ts) | — (indexed source/test only) |
| [84](../design/doubao-runtime.md#L84) | Pinned `2.38.4` (`darwin-arm64` only, zero npm fetches), SHA-256 verify, traversal & explicit symlink tar rejection, old/new capability skew, monotonic `switchedAt` preservation | [doubao-subscription.test.ts](../../packages/shared/test/doubao-subscription.test.ts) | — (indexed source/test only) |
| [85](../design/doubao-runtime.md#L85) | Host `HOME` preservation & `DOUBAO_CLI_NO_UPDATE_CHECK=1` injection | [step-env.test.ts](../../apps/daemon/test/step-env.test.ts) | — (indexed source/test only) |
| [86](../design/doubao-runtime.md#L86) | Managed vs macOS native resolution (zero env/PATH), ACP `bypass_permissions`, restricted fail-closed, `-32000` auth revocation, resume/timeout/exit/cancel, & probe `startedAt` + `invalidateAuth()` race | [doubao-acp.test.ts](../../apps/daemon/test/doubao-acp.test.ts) | — (indexed source/test only) |
| [87](../design/doubao-runtime.md#L87) | Runner QR lifecycle: PNG relay, `scanned`/`verifying`/`succeeded`, `expired`, phone refresh, `logoutFirst` failure/CLI logout, `keychain_locked`, `unsupported_account`, spawn/`refreshProbe` failures, `SIGKILL` before `cancelled` emit & respawn, aborted shared `ensure(signal)` recovery, exhausted emit retries | [doubao-login.test.ts](../../apps/daemon/test/doubao-login.test.ts) | — (indexed source/test only) |
| [88](../design/doubao-runtime.md#L88) | Subscription CRUD: unbound `models: []`, single enabled row (2nd saved disabled), multi-host model intersection `sharedRunnerModels`, 409 while claimed (disable/enable-other/rebind/delete), non-owner 403, `近 24 小时`, machine merge, fallback model source | [doubao-subscriptions.test.ts](../../apps/server/test/doubao-subscriptions.test.ts) | — (indexed source/test only) |
| [89](../design/doubao-runtime.md#L89) | Verify (`验证连接`): bearer auth (`ok`, `timeout`, `unavailable`, `missing_local_login`, `failed`), concurrent `429`, wrong runner `404` keeps pending, `switchingHold` block, mid-verify rebind `lastCheck` guard | [doubao-subscriptions.test.ts](../../apps/server/test/doubao-subscriptions.test.ts) | — (indexed source/test only) |
| [90](../design/doubao-runtime.md#L90) | Server QR state machine, `logoutFirst` durable `switchedAt`, late `succeeded` after cancel/timeout, rollback on offline send, unknown/stale `loginId` `404`, current-id duplicate rev `200`, invalid `409`, `scanned`/`verifying` -> `qr`, retired `failed` SSE + `409`, tx retry, old-runner `400`, `?loginId=` stale cancel, timeout | [doubao-subscriptions.test.ts](../../apps/server/test/doubao-subscriptions.test.ts) | — (indexed source/test only) |
| [91](../design/doubao-runtime.md#L91) | Routing coherence & single-host boundary: scanning non-default machine A runs generic tasks on A while explicit/local B still prompts B; unsupported `defaultMachineId` skipped; two authed accounts stay deterministically pinned (`machine-offline`, manual `alternateMachines`); Worker mid-claim `switchedAt` fenced-tx race + Coordinator `switchedAt` session reset; `doubao-subscription` & `model-unavailable`; auth failure -> fallback | [doubao-claim.test.ts](../../apps/server/test/doubao-claim.test.ts) | — (indexed source/test only) |
| [92](../design/doubao-runtime.md#L92) | Coordinator & Worker memory-correction guard (`promptMayNotBeResent`) on active Doubao turns | [doubao-claim.test.ts](../../apps/server/test/doubao-claim.test.ts) | — (indexed source/test only) |
| [93](../design/doubao-runtime.md#L93) | Static UI copy & missing-PNG `qr` fallback: detail `各电脑登录状态`, offline formerly-authed host, card states, non-owner notice, usage, model picker, Worker waiting inline QR, missing-PNG refresh button | [doubao-subscriptions.test.ts](../../apps/web/test/doubao-subscriptions.test.ts) | — (indexed source/test only) |
| [94](../design/doubao-runtime.md#L94) | Interactive Web UI (mocked HTTP/SSE): add w/ signed-in runner, zero runners + 500 retry, clean runner expired -> retry -> scan later (`稍后扫码`) -> detail same-`loginId` reattach -> completion, cached `succeeded` during switch account (`含本机 CLI`), stale `?loginId=` cancel QR preservation, `qr` missing-PNG refresh, all verify outcomes, 409 delete toast + retained row, GET/POST/DELETE error retry, real SSE reconnect `interrupted`, Coordinator (`/app`) & Worker (`side-chat`) inline QR, non-owner gating, 1440px & 390px light & dark layout | [providers-doubao-subscription.spec.ts](../../apps/web/e2e/providers-doubao-subscription.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>eval-daily-mini — 13 rows</summary>

Baseline anchors: [eval-daily.mjs](../../scripts/ops/eval-daily.mjs), [eval-daily.md:3](../../docs/ops/eval-daily.md#L3).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [59](../design/eval-daily-mini.md#L59) | `resolveDevinBin` lookup order, shared `laneEnv` child `HOME` isolation, and post-sync preflight | [lane-harness.test.ts](../../eval/lane-harness.test.ts), [eval-daily.test.mjs](../../scripts/ops/eval-daily.test.mjs) | — (indexed source/test only) |
| [60](../design/eval-daily-mini.md#L60) | Devin CLI defaults to `auto` permission mode and rejects edits | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [61](../design/eval-daily-mini.md#L61) | Devin auth (`stderr` + non-zero + 0 edits), missing binary (`ENOENT`), or quota (`stderr` + non-zero + 0 edits) vs stdout `"401"` or unrecognized exit `1` | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [62](../design/eval-daily-mini.md#L62) | Devin CLI hits `timeoutMs` (`ETIMEDOUT` / `signal`) or `ENOBUFS` (`maxBuffer`), plus `durationMs` | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [63](../design/eval-daily-mini.md#L63) | Secret tokens or home paths appear in stderr/stdout | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [64](../design/eval-daily-mini.md#L64) | `EVAL_MAX_DEVIN_RUNS` set to `""`, `"0"`, `"-1"`, `"abc"`, or `"12"` | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [65](../design/eval-daily-mini.md#L65) | Child Python writes `__pycache__/*.pyc` during Devin run or `checks.commands` | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [66](../design/eval-daily-mini.md#L66) | `fix-bug` valid `a + b` / `float(a)+float(b)`, and `rename-var` partial rename (`result` + `tmp`) or `tmpl` | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | replaced (`8102a8ed8`) |
| [67](../design/eval-daily-mini.md#L67) | `openExperimentClient` OTLP header & `runEval` Langfuse checks (`--offline --require-langfuse`, missing `BASE_URL`, `experiment.run` / `lf.close()` throw, `experimentId`, `traceUrl`, `itemResults` missing/mismatch) | [langfuse.test.ts](../../packages/shared/test/langfuse.test.ts), [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [68](../design/eval-daily-mini.md#L68) | Corrupt/empty `lock` or `lock.reclaim` (`<5s` vs `>=5s`), wait-for-exit reclaim (`10s` > 5s), third-process acquire race during reclaim, outer `owned-process` `SIGTERM` graceful write during eval or `pnpm install`, external signal kill on child, `runId` guard & displaced signal | [eval-daily.test.mjs](../../scripts/ops/eval-daily.test.mjs) | — (indexed source/test only) |
| [69](../design/eval-daily-mini.md#L69) | Daily runner failures (`CI=true`, dirty/untracked repo, `git fetch`, `pnpm install`, Langfuse health/config, missing/invalid `--out`, timeout/signal `124`/`128+N`, exit code `3`) and `ok`/`degraded`/`failed` scoring | [eval-daily.test.mjs](../../scripts/ops/eval-daily.test.mjs) | — (indexed source/test only) |
| [70](../design/eval-daily-mini.md#L70) | First run + two consecutive runs (`ok` / `degraded`), HTML XSS + HTTP(S) URL protocol filtering, `history.json` cap 60 + `runs/` pruning, and launchd plist `PATH` + env loading | [eval-daily.test.mjs](../../scripts/ops/eval-daily.test.mjs) | — (indexed source/test only) |
| [71](../design/eval-daily-mini.md#L71) | Retired `eval-weekly.yml` workflow, `ci.yml` trigger regex, `selfTests` wiring, and `doc-retired-terms` gate | [eval-daily.test.mjs](../../scripts/ops/eval-daily.test.mjs), [prepush.test.mjs](../../scripts/prepush.test.mjs), [repo-hygiene.test.mjs](../../scripts/ops/repo-hygiene.test.mjs), [merge-queue-invariants.test.mjs](../../scripts/ops/merge-queue-invariants.test.mjs) | — (indexed source/test only) |

</details>

<details>
<summary>eval-public-results — 8 rows</summary>

Baseline anchors: [eval-public-results.mjs:71](../../scripts/ops/eval-public-results.mjs#L71), [Home.astro:580](../../site/src/components/Home.astro#L580).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [30](../design/eval-public-results.md#L30) | Complete official run with repeated runtime trials and mixed lane outcomes | [eval-public-results.test.mjs](../../scripts/ops/eval-public-results.test.mjs) | — (indexed source/test only) |
| [31](../design/eval-public-results.md#L31) | Partial `--only` run, missing/duplicate/extra trial, wrong exact `(kind, caseId, repeat)` matrix, or non-zero eval exit | [eval-daily.test.mjs](../../scripts/ops/eval-daily.test.mjs) | — (indexed source/test only) |
| [32](../design/eval-public-results.md#L32) | Private diagnostics, trace data, internal URL/path/token/quota text, unknown case id, or unexpected key would enter output | [eval-public-results.test.mjs](../../scripts/ops/eval-public-results.test.mjs) | — (indexed source/test only) |
| [33](../design/eval-public-results.md#L33) | Public branch missing or containing extra tracked files or a symlink at `latest.json` | [eval-public-results.test.mjs](../../scripts/ops/eval-public-results.test.mjs) | — (indexed source/test only) |
| [34](../design/eval-public-results.md#L34) | Identical content, stale/newer remote, missing/fork/non-canonical origin, or push/network failure | [eval-public-results.test.mjs](../../scripts/ops/eval-public-results.test.mjs) | — (indexed source/test only) |
| [35](../design/eval-public-results.md#L35) | Valid public JSON in English and Chinese | [site-search.test.ts](../../integration/test/site-search.test.ts) | replaced in part (`338fe19b3`) |
| [36](../design/eval-public-results.md#L36) | Fetch 404/500/network/timeout, malformed JSON/schema, empty cases, or disabled JS | [site-search.test.ts](../../integration/test/site-search.test.ts) | — (indexed source/test only) |
| [37](../design/eval-public-results.md#L37) | Snapshot older than 48 hours | [site-search.test.ts](../../integration/test/site-search.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>eval-real-tasks — 8 rows</summary>

Baseline anchors: [lane.ts:169](../../eval/harness/lane.ts#L169), [lane.ts:324](../../eval/harness/lane.ts#L324).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [33](../design/eval-real-tasks.md#L33) | Parent snapshot tree equality and single-commit history isolation | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [34](../design/eval-real-tasks.md#L34) | Hidden test overlay and ancestor/leaf symlink tampering defense | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [35](../design/eval-real-tasks.md#L35) | Nop fails vs valid fix passes, dependency drift (`incomplete`), and command timeout/spawn diagnostics | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [36](../design/eval-real-tasks.md#L36) | Missing `parentCommit`/`fixCommit`, invalid SHA/path escape, or missing blob/tar failure | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [37](../design/eval-real-tasks.md#L37) | Workspace `node_modules` symlink repointing, diff filtering, `fileChecks`/`allowPaths`, and temp cleanup on error + stale sweep | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [38](../design/eval-real-tasks.md#L38) | Suite manifest v2, git parent/fix verification, hard 100m budget bound, and public-results compatibility (including `incomplete` matrix & 48h stale / fallback behavior) | [eval-suite.test.ts](../../apps/server/test/eval-suite.test.ts) | — (indexed source/test only) |
| [39](../design/eval-real-tasks.md#L39) | Compatibility with existing Devin CLI flags, auth/quota/permission/ENOENT, timeout/ENOBUFS, scrubbing, `resolveDevinCap`, and Langfuse exit 3 | [lane-harness.test.ts](../../eval/lane-harness.test.ts) | — (indexed source/test only) |
| [40](../design/eval-real-tasks.md#L40) | Harvester `--verify` (baseline/nop/oracle-patch) and `--scan` failure modes | [harvest.test.ts](../../eval/harvest.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>geo-loop — 14 rows</summary>

Baseline anchors: [quality-gate.mjs:222](../../scripts/geo/quality-gate.mjs#L222), [snapshot-metrics.mjs:7](../../scripts/geo/snapshot-metrics.mjs#L7).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [34](../design/geo-loop.md#L34) | Near-duplicate or keyword-variant page added in same locale | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [35](../design/geo-loop.md#L35) | Guide cites missing repo file, unrelated non-supporting source file, dead internal route, or unknown `cairn` CLI subcommand | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [36](../design/geo-loop.md#L36) | Valid slug binds wrong template/cluster, drifts off topic in title/opening sentence, or has mismatched JSON-LD | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [37](../design/geo-loop.md#L37) | Page contradicts Mac-first positioning, claims planned features shipped, uses invalid `verifiedVersion`, or ages `>90d` | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs), [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |
| [38](../design/geo-loop.md#L38) | Comparison page lacks dated `competitorSources` or concession heading | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [39](../design/geo-loop.md#L39) | Genuine same-slug EN/ZH localization vs cross-slug duplicate copy or distinct ZH page reusing EN `source_urls` | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [40](../design/geo-loop.md#L40) | Thin page below floor, stuffed title, missing build/prepush wiring, duplicate beacon, broken robots, or missing EN/ZH sidebar link | [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [41](../design/geo-loop.md#L41) | Citation panel includes Anthropic/Claude or paid API mode | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |
| [42](../design/geo-loop.md#L42) | Browser disconnected (`--init-blocked`), partial same-day recovery, `>14d` `panelStale` ignoring `EXPAND`, or malformed JSONL | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |
| [43](../design/geo-loop.md#L43) | Freeze precedence (`--manual-action` > `<50%`), auto-persisted `maintenance-state.json` (unless `--dry-run`), unfreeze, and gate block | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs), [quality-gate.test.mjs](../../scripts/geo/quality-gate.test.mjs) | — (indexed source/test only) |
| [44](../design/geo-loop.md#L44) | Empty GSC, undated/stale GSC (`>14d`), `<50%` aged coverage, invalid `publishedAt`, and absolute/relative URL mismatch | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |
| [45](../design/geo-loop.md#L45) | Page `crawled_not_indexed` `>=42d` with topical/hub peer vs unrelated page, plus repeat 301 run | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |
| [46](../design/geo-loop.md#L46) | CLI `snapshot-metrics.mjs` without `gh`/creds, partial GitHub 403, Linux noise floor, or CF HTTP 200 GraphQL errors | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |
| [47](../design/geo-loop.md#L47) | IndexNow missing sitemap or failed live key/route check, off-site URL, 24h duplicate hash, HTTP `429`, or timeout | [geo-loop.test.mjs](../../scripts/geo/geo-loop.test.mjs) | — (indexed source/test only) |

</details>

<details>
<summary>html-slides-viewer — 15 rows</summary>

Baseline anchors: [page-artifact.tsx:578](../../apps/web/src/board/artifact/page-artifact.tsx#L578), [deck-pager.tsx:75](../../apps/web/src/board/artifact/viewers/deck-pager.tsx#L75).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [50](../design/html-slides-viewer.md#L50) | Detection: the mark in any case; a carousel of `section.slide` without the mark; `data-slideshow`; `data-slides` on a `div`, inside a comment, inside a quoted attribute value, or a fake `<html data-slides>` inside another tag's value | [slide-deck.test.ts](../../apps/web/test/slide-deck.test.ts) | — (indexed source/test only) |
| [51](../design/html-slides-viewer.md#L51) | Slide comment place label in the list | [slide-deck.test.ts](../../apps/web/test/slide-deck.test.ts) | — (indexed source/test only) |
| [52](../design/html-slides-viewer.md#L52) | Slide comment with a structural selector sent to the task | [design-comment-block.test.ts](../../packages/shared/test/design-comment-block.test.ts) | — (indexed source/test only) |
| [53](../design/html-slides-viewer.md#L53) | Deck opens | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [54](../design/html-slides-viewer.md#L54) | Next, previous, keys with focus in the frame, a key typed in a field inside the slide, first and last slide | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [55](../design/html-slides-viewer.md#L55) | Present with the comment list open, page with →, Esc | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [56](../design/html-slides-viewer.md#L56) | Browser refuses full screen | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [57](../design/html-slides-viewer.md#L57) | Browser has no full screen | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [58](../design/html-slides-viewer.md#L58) | Present from the last slide, then ← | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [59](../design/html-slides-viewer.md#L59) | Comment on slide 3, page back to slide 1, click the row | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [60](../design/html-slides-viewer.md#L60) | Pick an element, then page before saving | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [61](../design/html-slides-viewer.md#L61) | Deck comment mode | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [62](../design/html-slides-viewer.md#L62) | Comment made before the file was a deck; comment on a slide past the end | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [63](../design/html-slides-viewer.md#L63) | On slide 3, open an older one-slide version, then back to current (reload uses the same document key path) | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [64](../design/html-slides-viewer.md#L64) | Source view and back | [artifact-slides.spec.ts](../../apps/web/e2e/artifact-slides.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |

</details>

<details>
<summary>idle-memory-extraction — 10 rows</summary>

Baseline anchors: [idle-memory.test.ts:150](../../apps/server/test/coordinator/idle-memory.test.ts#L150), [seed.ts:91](../../apps/server/src/coordinator/runtime/seed.ts#L91).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [20](../design/idle-memory-extraction.md#L20) | Team or project conversation goes idle; one resumes later | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [21](../design/idle-memory-extraction.md#L21) | Not yet idle, pending or claimed turn, waiting for quota, pending input, archived or no provider | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [22](../design/idle-memory-extraction.md#L22) | Conversation resumes, or team/project memory changes while the request runs | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [23](../design/idle-memory-extraction.md#L23) | Same-timestamp message, empty output or a second unchanged sweep | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [24](../design/idle-memory-extraction.md#L24) | Many threads or a large unprocessed backlog | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [25](../design/idle-memory-extraction.md#L25) | Provider error (including quota), hung response or shutdown | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [26](../design/idle-memory-extraction.md#L26) | Crash or unexpected write failure before cursor commit | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [27](../design/idle-memory-extraction.md#L27) | Live worker record older than 30 days | [step-session-upload.test.ts](../../apps/server/test/step-session-upload.test.ts) | — (indexed source/test only) |
| [28](../design/idle-memory-extraction.md#L28) | Snapshot exceeds the old age or team storage limit | [coordinator-turn-snapshot.test.ts](../../apps/server/test/coordinator-turn-snapshot.test.ts), [turn-snapshot.test.ts](../../apps/server/test/coordinator/turn-snapshot.test.ts) | — (indexed source/test only) |
| [29](../design/idle-memory-extraction.md#L29) | Upgrade, legacy read, or unrelated threads with large history | [coordinator-turn-snapshot.test.ts](../../apps/server/test/coordinator-turn-snapshot.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>idle-summary-routing — 3 rows</summary>

Baseline anchors: [idle-memory.test.ts:150](../../apps/server/test/coordinator/idle-memory.test.ts#L150), [privacy.md:29](../../docs/privacy.md#L29).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [16](../design/idle-summary-routing.md#L16) | Subscription chat with a connected HTTP model but no overrides | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [17](../design/idle-summary-routing.md#L17) | Subscription chat with an explicit summary rule | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |
| [18](../design/idle-summary-routing.md#L18) | The selected fallback provider errors, even if it echoes its credential | [idle-memory.test.ts](../../apps/server/test/coordinator/idle-memory.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>im-mobile-channel-polish — 7 rows</summary>

Baseline anchor: [settings-im.spec.ts:194](../../apps/web/e2e/settings-im.spec.ts#L194).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [55](../design/im-mobile-channel-polish.md#L55) | Paired user replies `"1"`, `"2."`, full-width `"１"`, or exact label `"发送"` to a pending approval or question card | [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [56](../design/im-mobile-channel-polish.md#L56) | Reply `"0"`, `"9"` (out of bounds), non-matching text, attachment-carrying message, or unpaired sender while card is pending | [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [57](../design/im-mobile-channel-polish.md#L57) | Telegram reconnects or stops mid-attachment-download after update `101` | [im-telegram.test.ts](../../apps/server/test/im-telegram.test.ts), [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [58](../design/im-mobile-channel-polish.md#L58) | WeChat restarts after polling `get_updates_buf` and `context_token` for >50 senders | [im-wechat.test.ts](../../apps/server/test/im-wechat.test.ts), [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [59](../design/im-mobile-channel-polish.md#L59) | Failure paths: invalid `pollOffset`, corrupt `contextTokensJson`, corrupt `secretCipher`, deleted row callbacks, and stale-session send race during reconnect | [im-core.test.ts](../../apps/server/test/im-core.test.ts), [im-telegram.test.ts](../../apps/server/test/im-telegram.test.ts), [im-wechat.test.ts](../../apps/server/test/im-wechat.test.ts) | — (indexed source/test only) |
| [60](../design/im-mobile-channel-polish.md#L60) | `permanent` / exhausted `retry` `lastSendError` clears on next success & reconnect, and obeys Rule C5 on UI | [im-core.test.ts](../../apps/server/test/im-core.test.ts), [settings-im.spec.ts](../../apps/web/e2e/settings-im.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [61](../design/im-mobile-channel-polish.md#L61) | Healthy `ready` connection manually reconnected via `...` menu | [im-core.test.ts](../../apps/server/test/im-core.test.ts), [settings-im.spec.ts](../../apps/web/e2e/settings-im.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |

</details>

<details>
<summary>im-ux-steering-cards-pairing — 4 rows</summary>

Baseline anchor: [settings-im.spec.ts:336](../../apps/web/e2e/settings-im.spec.ts#L336).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [55](../design/im-ux-steering-cards-pairing.md#L55) | IM turn invokes `notify_user` or `ask_user` then finishes with an internal summary note | [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [56](../design/im-ux-steering-cards-pairing.md#L56) | Slack `block_actions` or Telegram `callback_query` answers (or re-clicks) an interactive card | [im-slack.test.ts](../../apps/server/test/im-slack.test.ts), [im-telegram.test.ts](../../apps/server/test/im-telegram.test.ts), [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [57](../design/im-ux-steering-cards-pairing.md#L57) | Second same-origin IM message arrives while first turn is unstarted `pending` or `claimed`, vs cross-chat / Web turn | [im-core.test.ts](../../apps/server/test/im-core.test.ts) | — (indexed source/test only) |
| [58](../design/im-ux-steering-cards-pairing.md#L58) | Pending IM pairing request arrives while user is on `/app` (including alongside a device request and on 390px viewport) | [settings-im.spec.ts](../../apps/web/e2e/settings-im.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |

</details>

<details>
<summary>in-app-cloud-account — 9 rows</summary>

Baseline anchors: [sidebar-account.tsx](../../apps/web/src/board/sidebar-account.tsx), [cloud-account.ts:131](../../apps/server/src/services/cloud-account.ts#L131).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [51](../design/in-app-cloud-account.md#L51) | Paired device (`via === 'device'`) calls `GET /api/cloud/status` or `/connect/start`, `/checkout`, `/billing-portal`, or `/disconnect` | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts), [sidebar-account.test.ts](../../apps/web/test/sidebar-account.test.ts) | — (indexed source/test only) |
| [52](../design/in-app-cloud-account.md#L52) | Unconfigured server (`CAIRN_CLOUD_URL` unset) or non-HTTPS remote `CAIRN_CLOUD_URL` | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts) | — (indexed source/test only) |
| [53](../design/in-app-cloud-account.md#L53) | Invalid `returnTo` (external URL, `//evil.com`, `\`, non-`/app`) or malformed non-HTTPS control-plane redirect URL | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts) | — (at-landing mismatch) |
| [54](../design/in-app-cloud-account.md#L54) | Replayed, missing, or expired OAuth `state` hits `GET /api/cloud/callback` (and Desktop `shell === 'desktop'` completion) | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts) | — (indexed source/test only) |
| [55](../design/in-app-cloud-account.md#L55) | Control plane `401`, concurrent login vs stale `401` delete race, corrupt/wrong-key `cloud-account.enc`, expired `expiresAt`, or offline cloud control plane | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts) | — (indexed source/test only) |
| [56](../design/in-app-cloud-account.md#L56) | PKCE pending map reaches 32 active flows | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts) | — (indexed source/test only) |
| [57](../design/in-app-cloud-account.md#L57) | Desktop `startServer` and `buildResidentPlist` default vs `CAIRN_CLOUD_URL=off` | [cloud-account.test.ts](../../apps/server/test/cloud-account.test.ts) | — (indexed source/test only) |
| [58](../design/in-app-cloud-account.md#L58) | Bottom-left `SidebarAccount` renders unlinked local state vs linked Clerk profile, workspace actions, & opens upward popover cleanly | [sidebar-account.test.ts](../../apps/web/test/sidebar-account.test.ts) | — (indexed source/test only) |
| [59](../design/in-app-cloud-account.md#L59) | Sidebar footer keeps compact 56px height and right-aligned footer utility icons unchanged | [sidebar-visual.spec.ts](../../apps/web/e2e/sidebar-visual.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>keep-awake-modes — 16 rows</summary>

Baseline anchors: [native-tray.ts:116](../../apps/desktop/src/native-tray.ts#L116), [smoke-mac.mjs:499](../../apps/desktop/scripts/smoke-mac.mjs#L499), [tray-page.tsx:252](../../apps/web/src/tray/tray-page.tsx#L252).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [24](../design/keep-awake-modes.md#L24) | First launch or missing choice file | [keep-awake.test.ts](../../apps/desktop/scripts/keep-awake.test.ts) | — (indexed source/test only) |
| [25](../design/keep-awake-modes.md#L25) | Legacy `on`, legacy `off`, unknown or truncated choice file exists before upgrade | [keep-awake.test.ts](../../apps/desktop/scripts/keep-awake.test.ts) | — (indexed source/test only) |
| [26](../design/keep-awake-modes.md#L26) | Selection write fails, then the user presses the same row again | [keep-awake.test.ts](../../apps/desktop/scripts/keep-awake.test.ts) | — (indexed source/test only) |
| [27](../design/keep-awake-modes.md#L27) | Task starts, finishes, or several tasks overlap on macOS | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [28](../design/keep-awake-modes.md#L28) | User repeatedly presses modes or switches modes mid-task | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [29](../design/keep-awake-modes.md#L29) | Runner outbox is missing, malformed, temporarily unreadable or becomes readable again | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [30](../design/keep-awake-modes.md#L30) | Runner is off or failed while stale `running` or `awaiting-upload` rows remain | [keep-awake.test.ts](../../apps/desktop/scripts/keep-awake.test.ts) | — (indexed source/test only) |
| [31](../design/keep-awake-modes.md#L31) | User submits then closes the lid before a claim, or closes it immediately after a claim | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [32](../design/keep-awake-modes.md#L32) | Compute finishes but upload is offline, later recovers, or is abandoned | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [33](../design/keep-awake-modes.md#L33) | Mac is on battery before the menu opens, including a stored `lid-closed` choice | [tray-native.test.ts](../../apps/web/test/tray-native.test.ts) | — (indexed source/test only) |
| [34](../design/keep-awake-modes.md#L34) | Mac is unplugged or replugged while work is active, or power changes while the menu is open | [tray-native.test.ts](../../apps/web/test/tray-native.test.ts), [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [35](../design/keep-awake-modes.md#L35) | Native helper restarts, the web model is unavailable, or the model is schema-rejected | [native-tray-action.test.ts](../../apps/desktop/scripts/native-tray-action.test.ts) | replaced in part (`28c72654b`) |
| [36](../design/keep-awake-modes.md#L36) | Windows or Linux desktop opens the menu | [keep-awake.test.ts](../../apps/desktop/scripts/keep-awake.test.ts) | — (indexed source/test only) |
| [37](../design/keep-awake-modes.md#L37) | Blocker start throws, caffeinate is missing, or the caffeinate child exits asynchronously | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts), [keep-awake.test.ts](../../apps/desktop/scripts/keep-awake.test.ts) | — (indexed source/test only) |
| [38](../design/keep-awake-modes.md#L38) | Desktop or daemon exits or crashes mid-task | [task-sleep-prevention.test.ts](../../apps/daemon/test/task-sleep-prevention.test.ts) | — (indexed source/test only) |
| [39](../design/keep-awake-modes.md#L39) | Packaged native menu is clicked in the Mac smoke run | [native-tray-action.test.ts](../../apps/desktop/scripts/native-tray-action.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>lost-reply-client-message-id — 12 rows</summary>

Baseline anchors: [0264_message_client_id.sql:1](../../apps/server/drizzle/0264_message_client_id.sql#L1), [outbox.ts:581](../../apps/web/src/chief/outbox.ts#L581).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [58](../design/lost-reply-client-message-id.md#L58) | Task reply (`steer`, `new-turn`, `revision`, `restart`) committed on server while HTTP response drops | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts), [outbox-retire-on-load.test.ts](../../apps/web/test/outbox-retire-on-load.test.ts) | — (indexed source/test only) |
| [59](../design/lost-reply-client-message-id.md#L59) | Queued or `stop-and-send` task message reloaded while still in `queued_message` | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts), [outbox-retire-on-load.test.ts](../../apps/web/test/outbox-retire-on-load.test.ts) | — (indexed source/test only) |
| [60](../design/lost-reply-client-message-id.md#L60) | Queued task message drains into `message` (auto-drain or Send Now) | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts) | — (indexed source/test only) |
| [61](../design/lost-reply-client-message-id.md#L61) | Queued message moves to a new build (`moveQueuedMessages`) or replaces stranded send | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts), [outbox-retire-on-load.test.ts](../../apps/web/test/outbox-retire-on-load.test.ts) | — (indexed source/test only) |
| [62](../design/lost-reply-client-message-id.md#L62) | Coordinator (`chief_message`) send commits while HTTP response drops | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts), [outbox-retire-on-load.test.ts](../../apps/web/test/outbox-retire-on-load.test.ts) | — (indexed source/test only) |
| [63](../design/lost-reply-client-message-id.md#L63) | Coordinator-origin synthetic thread message using internal `nested:` ledger key | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts) | — (indexed source/test only) |
| [64](../design/lost-reply-client-message-id.md#L64) | Pre-migration rows with `clientMessageId = null` | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts) | — (indexed source/test only) |
| [65](../design/lost-reply-client-message-id.md#L65) | Failed or returned-to-draft outbox entry already committed on server (even when IndexedDB `resume()` finishes after messages loaded) | [outbox-retire-on-load.test.ts](../../apps/web/test/outbox-retire-on-load.test.ts) | — (indexed source/test only) |
| [66](../design/lost-reply-client-message-id.md#L66) | Reopening finished task with long (~2070 px) agent output before the user's single follow-up reply | [scroll-anchor.test.ts](../../apps/web/test/scroll-anchor.test.ts), [detail-lost-reply-reopen.spec.ts](../../apps/web/e2e/detail-lost-reply-reopen.spec.ts) | — (indexed source/test only) |
| [67](../design/lost-reply-client-message-id.md#L67) | Reopening finished task whose single user message is at start (`DEMO.cartMerge`, `!hasEarlier`, only `run` before `user`) | [scroll-anchor.test.ts](../../apps/web/test/scroll-anchor.test.ts), [detail-lost-reply-reopen.spec.ts](../../apps/web/e2e/detail-lost-reply-reopen.spec.ts) | — (indexed source/test only) |
| [68](../design/lost-reply-client-message-id.md#L68) | Reader scrolling during a pending send or loading earlier pages (`hasEarlier = true`) | [scroll-anchor.test.ts](../../apps/web/test/scroll-anchor.test.ts), [detail-lost-reply-reopen.spec.ts](../../apps/web/e2e/detail-lost-reply-reopen.spec.ts) | — (indexed source/test only) |
| [69](../design/lost-reply-client-message-id.md#L69) | Legacy client/daemon payloads omitting `clientMessageId` and existing daemon step-claim/turn protocol | [message-client-id.test.ts](../../apps/server/test/message-client-id.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>multi-quote-reply — 21 rows</summary>

Baseline anchors: [reply-quote.ts:44](../../packages/shared/src/reply-quote.ts#L44), [chief-conversation.tsx:262](../../apps/web/src/chief/chief-conversation.tsx#L262).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [50](../design/multi-quote-reply.md#L50) | Two quotes each with a reply plus main text | [reply-quote-wire.test.ts](../../packages/shared/test/reply-quote-wire.test.ts), [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [51](../design/multi-quote-reply.md#L51) | Two quotes, main input empty | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [52](../design/multi-quote-reply.md#L52) | Reply, main text or an older single-quote message holding marker and `>` lines | [reply-quote-wire.test.ts](../../packages/shared/test/reply-quote-wire.test.ts) | — (indexed source/test only) |
| [53](../design/multi-quote-reply.md#L53) | One quote and one text, from the quote box or the main input | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [54](../design/multi-quote-reply.md#L54) | One quote with its own reply plus main text | [reply-quote-wire.test.ts](../../packages/shared/test/reply-quote-wire.test.ts) | — (indexed source/test only) |
| [55](../design/multi-quote-reply.md#L55) | Task brief from a two-quote message | [reply-quote-wire.test.ts](../../packages/shared/test/reply-quote-wire.test.ts) | — (indexed source/test only) |
| [56](../design/multi-quote-reply.md#L56) | Task from a two-quote message | [coordinator-reply-context.test.ts](../../apps/server/test/coordinator-reply-context.test.ts) | — (indexed source/test only) |
| [57](../design/multi-quote-reply.md#L57) | A source message missing or quoted twice | [coordinator-reply-context.test.ts](../../apps/server/test/coordinator-reply-context.test.ts) | — (indexed source/test only) |
| [58](../design/multi-quote-reply.md#L58) | Partial selection keeps one of two sources | [task-request.test.ts](../../packages/shared/test/task-request.test.ts) | — (indexed source/test only) |
| [59](../design/multi-quote-reply.md#L59) | Quote-box Enter | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [60](../design/multi-quote-reply.md#L60) | Same passage quoted twice, or the same words at two places | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [61](../design/multi-quote-reply.md#L61) | Remove one of two items | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [62](../design/multi-quote-reply.md#L62) | A message of quotes alone, no reply and no main text, waiting in the queue | [chief-home-busy.spec.ts](../../apps/web/e2e/chief-home-busy.spec.ts) | — (indexed source/test only) |
| [63](../design/multi-quote-reply.md#L63) | Send now while other items are staged | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [65](../design/multi-quote-reply.md#L65) | Withdraw a held single-quote message | [chief-reply-quote.spec.ts](../../apps/web/e2e/chief-reply-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [66](../design/multi-quote-reply.md#L66) | Withdraw a held multi-quote message while a draft exists | [chief-reply-quote.spec.ts](../../apps/web/e2e/chief-reply-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [67](../design/multi-quote-reply.md#L67) | Remove a queued message while a draft exists | [chief-home-busy.spec.ts](../../apps/web/e2e/chief-home-busy.spec.ts) | — (indexed source/test only) |
| [68](../design/multi-quote-reply.md#L68) | Withdraw an unread quoted steer while a draft exists | [chief-home-busy.spec.ts](../../apps/web/e2e/chief-home-busy.spec.ts) | — (indexed source/test only) |
| [69](../design/multi-quote-reply.md#L69) | Ten quotes staged at 1440 and 390 | [chief-reply-quote.spec.ts](../../apps/web/e2e/chief-reply-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [70](../design/multi-quote-reply.md#L70) | Send fails and the outbox returns it | [chief-selection-quote.spec.ts](../../apps/web/e2e/chief-selection-quote.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [75](../design/multi-quote-reply.md#L75) | Composer shadow | [composer-drop-wrap.test.ts](../../apps/web/test/composer-drop-wrap.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>multi-tab-streams — 8 rows</summary>

Baseline anchors: [sse.ts:52](../../apps/web/src/api/sse.ts#L52), [team-stream-socket.ts:93](../../apps/server/src/services/team-stream-socket.ts#L93).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [18](../design/multi-tab-streams.md#L18) | Seven app tabs over HTTP/1.1 | [multi-tab-streams.spec.ts](../../apps/web/e2e/multi-tab-streams.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [19](../design/multi-tab-streams.md#L19) | One tab closes | [team-stream-socket.test.ts](../../apps/server/test/team-stream-socket.test.ts) | — (indexed source/test only) |
| [20](../design/multi-tab-streams.md#L20) | Server restart or sleep/wake drops the connection | [stream-transport.test.ts](../../apps/web/test/stream-transport.test.ts), [team-stream-socket.test.ts](../../apps/server/test/team-stream-socket.test.ts) | — (indexed source/test only) |
| [21](../design/multi-tab-streams.md#L21) | Proxy strips upgrades, or handshake never completes | [stream-transport.test.ts](../../apps/web/test/stream-transport.test.ts) | — (indexed source/test only) |
| [22](../design/multi-tab-streams.md#L22) | Old server or fixture does not advertise WebSocket | [stream-transport.test.ts](../../apps/web/test/stream-transport.test.ts) | — (indexed source/test only) |
| [23](../design/multi-tab-streams.md#L23) | Tab signs out while a ticket is pending | [stream-transport.test.ts](../../apps/web/test/stream-transport.test.ts) | — (indexed source/test only) |
| [25](../design/multi-tab-streams.md#L25) | Missing, reused or revoked device ticket; foreign origin or team | [team-stream-socket.test.ts](../../apps/server/test/team-stream-socket.test.ts) | — (indexed source/test only) |
| [26](../design/multi-tab-streams.md#L26) | Screen stream, unknown upgrade path, tailnet TLS, or shutdown with tabs open | [team-stream-socket.test.ts](../../apps/server/test/team-stream-socket.test.ts), [tsnet-remote.test.ts](../../apps/server/test/tsnet-remote.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>no-git-folder — 9 rows</summary>

Baseline anchors: [build-merge-request.ts](../../apps/server/src/services/build-merge-request.ts), [no-git-folder.md:27](../../docs/design/no-git-folder.md#L27).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [50](../design/no-git-folder.md#L50) | Create/browse plain folder (empty dir, missing/oversized README, `/files` limit, `commit: 'workspace'`, empty `/branches`, escaping symlink ignored, no `.git`, built-in excludes & `CACHEDIR.TAG`, `showFull` reads current file & 404 fallback) | [plain-folder-project.test.ts](../../apps/server/test/plain-folder-project.test.ts), [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts) | — (indexed source/test only) |
| [51](../design/no-git-folder.md#L51) | Subdirectory inside Git repo (no own `.git`), disk mode change, and existing Git repo root guard (including no Undo button) | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts), [workspace-local-unreachable.test.ts](../../apps/daemon/test/workspace-local-unreachable.test.ts), [project-local.test.ts](../../apps/server/test/project-local.test.ts), [plain-folder-undo.test.ts](../../apps/web/test/plain-folder-undo.test.ts) | — (indexed source/test only) |
| [52](../design/no-git-folder.md#L52) | Parallel tasks (`convA`, `convB`) on same/overlapping folders + non-CoW cross-volume total-size fallback + `AGENT_TOOL_PUSH` omitted | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts) | — (indexed source/test only) |
| [53](../design/no-git-folder.md#L53) | Huge folder (`> 2 GiB` after excludes): serialized in-place, cancel while queued, huge readonly no-clone, mode migration across 2 GiB, normal `Stop` vs `Stop & Discard`, failed in-place run, timeout before start, excluded edits | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts) | — (indexed source/test only) |
| [54](../design/no-git-folder.md#L54) | Concurrent user edit (non-overlapping, overlapping, identical, post-snapshot write race), empty/binary/case-only rename, symlink/dir swap during write-back | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts), [plain-folder-project.test.ts](../../apps/server/test/plain-folder-project.test.ts) | — (indexed source/test only) |
| [55](../design/no-git-folder.md#L55) | Conflict UI (`5. Recommended` single-button constraint), retry via `POST /api/builds/:id/merge` (`409` on merged/undone/in-place), non-build steps (`plan`/`review`/`verify`) never write back | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts), [plain-folder-project.test.ts](../../apps/server/test/plain-folder-project.test.ts), [plain-folder-undo.test.ts](../../apps/web/test/plain-folder-undo.test.ts) | — (indexed source/test only) |
| [56](../design/no-git-folder.md#L56) | Undo flow: reverse merge preserving sibling/user edits, multi-leg undo, undo conflict, rapid double-click & POST error recovery, refresh/offline queue, stop/archive/supersede/move, crash `applying` journal recovery, receipt idempotency, GC `snapshot-missing` | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts), [plain-folder-project.test.ts](../../apps/server/test/plain-folder-project.test.ts), [plain-folder-undo.test.ts](../../apps/web/test/plain-folder-undo.test.ts) | — (indexed source/test only) |
| [57](../design/no-git-folder.md#L57) | Protected folders (`/`, `$HOME`, `Desktop`, `Documents`, `Downloads`, symlinks to them), subdirs allowed, plain file `not_directory`, missing/moved/`.git`-replaced folder | [plain-folder-project.test.ts](../../apps/server/test/plain-folder-project.test.ts), [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts) | — (indexed source/test only) |
| [58](../design/no-git-folder.md#L58) | Timeout (`120 s`), foreign `GIT_*`/`gpgsign=true`, Git `< 2.38`, non-`ENOSPC` copy/write errors & `ENOSPC` disk full + partial rollback failure | [plain-folder-workspace.test.ts](../../apps/daemon/test/plain-folder-workspace.test.ts), [plain-folder-project.test.ts](../../apps/server/test/plain-folder-project.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>notify-once — 12 rows</summary>

Baseline anchors: [notify-banner.spec.ts:6](../../apps/web/e2e/notify-banner.spec.ts#L6), [notify-click.spec.ts](../../apps/web/e2e/notify-click.spec.ts).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [109](../design/notify-once.md#L109) | At Mac looking at the same thread (`focused && activeThreadId === entityId`) | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts) | — (indexed source/test only) |
| [110](../design/notify-once.md#L110) | At Mac focused on Cairn in another thread (`focused && activeThreadId !== entityId`) | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts) | — (indexed source/test only) |
| [111](../design/notify-once.md#L111) | At Mac working in another app (unfocused behind Chrome, or closed to tray) | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts), [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts), [desktop-notifications.test.ts](../../apps/desktop/scripts/desktop-notifications.test.ts) | — (indexed source/test only) |
| [112](../design/notify-once.md#L112) | Two Macs connected (active vs idle/locked, or desktop vs web tab, or idle web tab alone) | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts), [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts) | — (indexed source/test only) |
| [113](../design/notify-once.md#L113) | Sequential lock across two Macs, brief disconnect `< 10m`, sleep/resume, server restart mid-grace, or window+tray handoff stale `seq` | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts) | — (indexed source/test only) |
| [114](../design/notify-once.md#L114) | Desktop `canNotify: false` (denied / `cairn.notifyEnabled === '0'`) or explicit pre-display `delivery-failed` with matching `deliveryId` | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts), [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts) | — (indexed source/test only) |
| [115](../design/notify-once.md#L115) | Away (`locked >= 60s` or `idle >= 10m`) with multiple IM connections + multiple push/APNs endpoints | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts) | — (indexed source/test only) |
| [116](../design/notify-once.md#L116) | Scheduled run completion/failure on both `todoId` and `chiefThreadId` (including pre-step failure, user stop, stage gate skip, retry, `finishTodoDone` order, and `notifyChiefTurn` suppression) | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts), [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts) | — (indexed source/test only) |
| [117](../design/notify-once.md#L117) | Read anywhere (`markNotificationRead` or `sweepIdleChiefUnread`), or `read -> markNotificationUnread`, or read after `away` claim before send | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts), [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts), [desktop-notifications.test.ts](../../apps/desktop/scripts/desktop-notifications.test.ts) | — (indexed source/test only) |
| [118](../design/notify-once.md#L118) | Both `mainWindow` and `/tray` receive SSE, `mainWindow === null` click, or deleted thread link | [desktop-notifications.test.ts](../../apps/desktop/scripts/desktop-notifications.test.ts), [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts) | — (indexed source/test only) |
| [119](../design/notify-once.md#L119) | Unfocused window still `visibilityState === 'visible'` behind another app | [sse-notify-once.test.ts](../../apps/web/test/sse-notify-once.test.ts) | — (indexed source/test only) |
| [120](../design/notify-once.md#L120) | IM-originated coordinator turn (`imTurnOrigin`) vs mixed IM/Web turn | [notify-once.test.ts](../../apps/server/test/notify-once.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>phone-computer — 26 rows</summary>

Baseline anchors: [machine-row.tsx:237](../../apps/web/src/resources/machine-row.tsx#L237), [create-machine-dialog.tsx:477](../../apps/web/src/resources/create-machine-dialog.tsx#L477).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [95](../design/phone-computer.md#L95) | Runner has no compatible adb and the user submits pairing | [phone-bootstrap.test.ts](../../apps/daemon/test/phone-bootstrap.test.ts) | — (indexed source/test only) |
| [96](../design/phone-computer.md#L96) | Platform-tools download is offline, interrupted, corrupt, or the extracted adb hash differs | [phone-bootstrap.test.ts](../../apps/daemon/test/phone-bootstrap.test.ts) | — (indexed source/test only) |
| [97](../design/phone-computer.md#L97) | Existing adb is compatible (system or verified cache on startup) | [phone-bootstrap.test.ts](../../apps/daemon/test/phone-bootstrap.test.ts), [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [98](../design/phone-computer.md#L98) | Existing adb is broken or lacks wireless `pair` support | [phone-bootstrap.test.ts](../../apps/daemon/test/phone-bootstrap.test.ts) | — (indexed source/test only) |
| [99](../design/phone-computer.md#L99) | Two pairing submissions race while adb is absent | [phone-bootstrap.test.ts](../../apps/daemon/test/phone-bootstrap.test.ts), [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |
| [100](../design/phone-computer.md#L100) | Dispatcher shuts down or signal aborts mid-download or mid-extraction | [phone-bootstrap.test.ts](../../apps/daemon/test/phone-bootstrap.test.ts), [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [101](../design/phone-computer.md#L101) | Runner restarts with consented phones but no adb path loaded | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [102](../design/phone-computer.md#L102) | Server restarts or pairing deadline passes before reaper runs, and a late pairing success frame arrives | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts), [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |
| [103](../design/phone-computer.md#L103) | `phoneHost` capability is absent on an online local macOS runner | [machines-phones.spec.ts](../../apps/web/e2e/machines-phones.spec.ts) | — (indexed source/test only) |
| [104](../design/phone-computer.md#L104) | Local macOS runner is offline on cold page load | [machines-phones.spec.ts](../../apps/web/e2e/machines-phones.spec.ts) | — (indexed source/test only) |
| [105](../design/phone-computer.md#L105) | Zero or several hostable runners exist | [machines-phones.spec.ts](../../apps/web/e2e/machines-phones.spec.ts) | — (indexed source/test only) |
| [106](../design/phone-computer.md#L106) | Pair dialog endpoint outside home-LAN ranges, or pending submit cancellation/Escape | [machines-phones.spec.ts](../../apps/web/e2e/machines-phones.spec.ts), [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |
| [107](../design/phone-computer.md#L107) | Phone runs Android older than 11 | [machines-phones.spec.ts](../../apps/web/e2e/machines-phones.spec.ts) | — (indexed source/test only) |
| [108](../design/phone-computer.md#L108) | Wireless or USB pairing succeeds and Android id is readable | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts), [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |
| [109](../design/phone-computer.md#L109) | Wireless adb auto-connects using an mDNS service instance serial (`adb-...._adb-tls-connect._tcp`) | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [110](../design/phone-computer.md#L110) | Real `MachineClient` executes `phoneConsent` check before adb command | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [111](../design/phone-computer.md#L111) | Re-adding an already-paired `android:<hex>` phone via `POST` | [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |
| [112](../design/phone-computer.md#L112) | Same Android id appears over USB and Wi-Fi | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [113](../design/phone-computer.md#L113) | Transport serial changes between observe and act | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [114](../design/phone-computer.md#L114) | Endpoint-keyed row from previous implementation is still connected, then re-paired | [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts), [machines-order-and-phones.test.ts](../../apps/web/test/machines-order-and-phones.test.ts) | — (indexed source/test only) |
| [115](../design/phone-computer.md#L115) | adb cache knows a private wireless serial but mDNS stops corroborating it, or probe fails | [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [116](../design/phone-computer.md#L116) | Retry of a stable row returns a different Android id | [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |
| [117](../design/phone-computer.md#L117) | A wireless phone returns as `unauthorized` after runner restart when its stable identity cannot be read | [machines-order-and-phones.test.ts](../../apps/web/test/machines-order-and-phones.test.ts), [machines-phones.spec.ts](../../apps/web/e2e/machines-phones.spec.ts) | — (indexed source/test only) |
| [118](../design/phone-computer.md#L118) | Owner removes a phone while a call is dispatched/running, or late frames arrive after removal | [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts), [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [119](../design/phone-computer.md#L119) | A phone-acting computer call is cancelled or consent fails mid-batch | [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts), [computer-phone.test.ts](../../apps/daemon/test/computer-phone.test.ts) | — (indexed source/test only) |
| [120](../design/phone-computer.md#L120) | Tailnet `100.64/10` endpoint entered in this home slice | [phone-computer.test.ts](../../apps/server/test/phone-computer.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>retire-info-card-pipeline — 6 rows</summary>

Baseline anchors: [0263_retire_info_card_schedules.sql:1](../../apps/server/drizzle/0263_retire_info_card_schedules.sql#L1), [chief.ts:1502](../../apps/server/src/services/chief.ts#L1502).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [44](../design/retire-info-card-pipeline.md#L44) | Upgrade real 0262 DB with orchestration info schedule (`sourceRef='chief:...'`), `event` schedule, cross-team & orphaned schedules, finished `done` info todo, and SQL rollback | [retire-info-card-migration.test.ts](../../apps/server/test/retire-info-card-migration.test.ts) | — (indexed source/test only) |
| [45](../design/retire-info-card-pipeline.md#L45) | Target validation, authorization, & selector rules (`createSchedule`, `chief-tools`, `mcp-face`, `unschedule_todo`) | [chief-schedule.test.ts](../../apps/server/test/chief-schedule.test.ts) | — (indexed source/test only) |
| [46](../design/retire-info-card-pipeline.md#L46) | End-to-end Coordinator create → controlled-clock Run-now & due firing → `finishCoordinatorTurn` (`completed`/`stopped`/transient `once` retry re-arm/permanent pause) → `lastRunStepId` guard | [chief-schedule.test.ts](../../apps/server/test/chief-schedule.test.ts) | — (indexed source/test only) |
| [47](../design/retire-info-card-pipeline.md#L47) | Concurrency & target lifecycle (competing schedules, busy `once`/webhook, webhook dedupe/ignore, archived/deleted `chiefThread`) | [chief-schedule.test.ts](../../apps/server/test/chief-schedule.test.ts) | — (indexed source/test only) |
| [48](../design/retire-info-card-pipeline.md#L48) | Retired info-card deletion & preserved plain-runner research claim (`openResearchThread` on `computer: false` host without `info-card-runner`) | [retire-info-card-migration.test.ts](../../apps/server/test/retire-info-card-migration.test.ts) | — (indexed source/test only) |
| [49](../design/retire-info-card-pipeline.md#L49) | Web UI list/menu/popover model & pause translation for `chiefThreadId` schedules (`todo: null`) | [schedule-editor.test.ts](../../apps/web/test/schedule-editor.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>run-log-window — 19 rows</summary>

Baseline anchors: [run-page.tsx:379](../../apps/web/src/runs/run-page.tsx#L379), [run-list.tsx:124](../../apps/web/src/runs/run-list.tsx#L124).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [53](../design/run-log-window.md#L53) | Spiral pressed | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [54](../design/run-log-window.md#L54) | `全部` pressed | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [55](../design/run-log-window.md#L55) | `出问题的` on, then off | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [56](../design/run-log-window.md#L56) | No runs at all (new user) | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [57](../design/run-log-window.md#L57) | `出问题的` on with no problem runs | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [58](../design/run-log-window.md#L58) | Thousands of runs | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [59](../design/run-log-window.md#L59) | A run deleted between two pages | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [60](../design/run-log-window.md#L60) | List row and trace status | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [61](../design/run-log-window.md#L61) | This conversation empty, team has runs | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [62](../design/run-log-window.md#L62) | A run still going | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [63](../design/run-log-window.md#L63) | Archived thread | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [64](../design/run-log-window.md#L64) | Deleted thread (row gone, steps orphaned) or internal digest/memory thread | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [65](../design/run-log-window.md#L65) | Another team's thread or turn | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [66](../design/run-log-window.md#L66) | Task run vs Coordinator turn | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [67](../design/run-log-window.md#L67) | Fixture mode `?scenario=run-trace` | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [68](../design/run-log-window.md#L68) | First page fails, then retry | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [69](../design/run-log-window.md#L69) | 390px phone width | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [70](../design/run-log-window.md#L70) | A run whose trace is gone | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [71](../design/run-log-window.md#L71) | Task opened from its menu (no thread) | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |

</details>

<details>
<summary>run-trace — 26 rows</summary>

Baseline anchors: [run-trace.ts:144](../../apps/server/src/services/run-trace.ts#L144), [run-page.tsx:229](../../apps/web/src/runs/run-page.tsx#L229).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [53](../design/run-trace.md#L53) | In-server entry with thinking, text and a tool call | [mirror-store-identity.test.ts](../../apps/server/test/coordinator/mirror-store-identity.test.ts) | — (indexed source/test only) |
| [54](../design/run-trace.md#L54) | Whitespace-only thinking; aborted entry; the stopped entry | [mirror-store-identity.test.ts](../../apps/server/test/coordinator/mirror-store-identity.test.ts) | — (indexed source/test only) |
| [55](../design/run-trace.md#L55) | Stored thinking rows in a long thread | [seed.test.ts](../../apps/server/test/coordinator/seed.test.ts) | — (indexed source/test only) |
| [56](../design/run-trace.md#L56) | Failed Coordinator turn with thinking, tools and an error | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [57](../design/run-trace.md#L57) | Tool row stamped exactly at the next turn's `claimedAt`; a late tool row of the previous turn | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [58](../design/run-trace.md#L58) | Old in-server turn without thinking rows | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [59](../design/run-trace.md#L59) | Tool output longer than 4,000 characters | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [60](../design/run-trace.md#L60) | Task run by build id and by build step id; todo id | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [61](../design/run-trace.md#L61) | Another team's run, a thread id, an unknown id, an unknown cursor | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | replaced in part (`844b769fc`) |
| [62](../design/run-trace.md#L62) | Export of a run | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [63](../design/run-trace.md#L63) | Turn list: 45 turns, filter on and off, cursor paging, two turns created in the same millisecond, quota-held turn | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [64](../design/run-trace.md#L64) | Failed notice and stopped row show `运行记录`; the link opens that turn | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [65](../design/run-trace.md#L65) | `看出错的那一步`, `只看报错`, next turn, last turn, Esc | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | replaced in part (`844b769fc`) |
| [66](../design/run-trace.md#L66) | Status mark press, filter default on, switch off, scroll loads more, day groups, ↑/↓ and Enter | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | replaced (`844b769fc`) |
| [67](../design/run-trace.md#L67) | Hint shows once, above the composer; opening the list retires it; Esc returns focus to the mark; reload | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | dropped focus; rest holds (`844b769fc`) |
| [68](../design/run-trace.md#L68) | Hint closed with × | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [69](../design/run-trace.md#L69) | The turn list's first load fails | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [70](../design/run-trace.md#L70) | Export pressed | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [71](../design/run-trace.md#L71) | A turn still running, with no owner list | [run-trace.test.ts](../../apps/server/test/run-trace.test.ts) | — (indexed source/test only) |
| [72](../design/run-trace.md#L72) | 390px window | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | replaced in part (`844b769fc`) |
| [73](../design/run-trace.md#L73) | Unknown run id opened directly from a link; then Esc | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [74](../design/run-trace.md#L74) | A real run opened directly from a link (no chat page before it); then Esc or the close button | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [75](../design/run-trace.md#L75) | A tool call with no result yet (the turn was stopped while it ran) | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [76](../design/run-trace.md#L76) | `只看报错` hides an expanded quiet row; then turned off | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [77](../design/run-trace.md#L77) | Live wiring: failure card link and turn list hit the team-scoped endpoints | [run-trace.spec.ts](../../apps/web/e2e/run-trace.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [78](../design/run-trace.md#L78) | Narrow layout mark is a button carrying its state | [chief-home-narrow-shell.spec.ts](../../apps/web/e2e/chief-home-narrow-shell.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>runner-token-rotation — 11 rows</summary>

Baseline anchors: [routes-resources.ts:473](../../apps/server/src/routes-resources.ts#L473), [machine-rotate-token.ts:154](../../apps/server/src/services/machine-rotate-token.ts#L154).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [55](../design/runner-token-rotation.md#L55) | Online rotation succeeds and real `MachineClient` completes SSE -> claim -> write -> ack -> reconnect -> step run | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [56](../design/runner-token-rotation.md#L56) | Offline rotation cuts over immediately and re-enroll (browser and API-key) restores the exact same row | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [57](../design/runner-token-rotation.md#L57) | Server restarts after `claim` (pending map lost) before `ack`, OR timeout races `ack` / `ack` response lost | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [58](../design/runner-token-rotation.md#L58) | Online Runner ignores `token.rotate` (old version / hung) or SSE push fails, OR 45s grace expires after handoff | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [59](../design/runner-token-rotation.md#L59) | Claim response lost, OR Runner claims then fails to ack before timeout, OR `hostKey` mismatches on `claim` | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [60](../design/runner-token-rotation.md#L60) | SSE disconnect or hijack replacement mid-rotation | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [61](../design/runner-token-rotation.md#L61) | Concurrent double rotate, concurrent revoke/delete/re-enroll CAS miss, unclaimed/superseded `ack`, DB failure, and browser abort | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [62](../design/runner-token-rotation.md#L62) | Auth & team isolation (unauthenticated, machine token, non-owner, paired device, other team, unknown/retired/un-enrolled row) | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [63](../design/runner-token-rotation.md#L63) | Secret hygiene across successful `claim` + `ack` and error paths | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [64](../design/runner-token-rotation.md#L64) | Daemon handles `token.rotate` while idle and during an active step, plus `ack` 401 rollback, transient `ack` retry, disk write failure, and 401 claim retry | [machine-rotate-token.test.ts](../../apps/daemon/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [65](../design/runner-token-rotation.md#L65) | UI one-step in-menu confirm, `R` repeat guard, slow network / rapid click, error/clipboard feedback, offline re-auth drawer, and 1440px/390px light/dark | [machine-rotate-token.spec.ts](../../apps/web/e2e/machine-rotate-token.spec.ts) | replaced (`495e22dc8`) |

</details>

<details>
<summary>search-messages — 8 rows</summary>

Baseline anchors: [search.ts:226](../../apps/server/src/services/search.ts#L226), [search-panel.tsx:245](../../apps/web/src/overlay/search-panel.tsx#L245).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [25](../design/search-messages.md#L25) | Chinese (`再加`), symbols (`1+1`, `100%_覆盖`), mixed text, NFKC full-width, multi-term queries via `GET /api/search` | [search-messages.test.ts](../../apps/server/test/search-messages.test.ts) | — (indexed source/test only) |
| [26](../design/search-messages.md#L26) | Coordinator (`projectId: null`) vs project thread hits, global newest-first order, tie-break, 20-hit cap, and 2,000-row per-thread reachability window | [search-messages.test.ts](../../apps/server/test/search-messages.test.ts) | — (indexed source/test only) |
| [27](../design/search-messages.md#L27) | Same-query isolation across teams, users, archived threads, personal spaces, `chief-digest-*`, `chief-memory-*`, and task `message` table | [search-messages.test.ts](../../apps/server/test/search-messages.test.ts) | — (indexed source/test only) |
| [28](../design/search-messages.md#L28) | Same-query visibility parity (`user-*` prompt echo, `origin: 'user'`, `synthetic`, `task-prompt`, orchestrated, `toolcall`, `thinking`, `API Error:`, `retry-parking:`, `runtimeUpdate`, `chief_notice`, `[wake:...]` `eventTurn`, `{ type: 'text' }` JSON content) | [search-messages.test.ts](../../apps/server/test/search-messages.test.ts) | — (bounded-scan edge unproven) |
| [29](../design/search-messages.md#L29) | Single indexed `chief_message(threadId, createdAt)` query plan | [search-messages.test.ts](../../apps/server/test/search-messages.test.ts) | — (query-plan evidence narrower) |
| [30](../design/search-messages.md#L30) | Long message with NFKC folding and newlines; syntax-filter queries (`is:failed`, `project:X`) | [search-messages.test.ts](../../apps/server/test/search-messages.test.ts) | — (indexed source/test only) |
| [31](../design/search-messages.md#L31) | `SearchPanel` renders `消息` hits, isolates stale `serverQueryText` / `isError` / `teamId`, navigates via `messageHitHref`, and `messageJumpStep` handles focus, 20-page cap, cancel-on-retarget, and missing/failed states | [search-messages.test.ts](../../apps/web/test/search-messages.test.ts) | — (indexed source/test only) |
| [32](../design/search-messages.md#L32) | End-to-end search palette click/keyboard jump (including off-screen virtualized row in a long 60-message conversation and stale Enter guard), `[data-message-id]` scroll without snapping back, `msg` cleanup, missing-message toast, 390px layout, and light/dark WCAG 2.2 AA | [search-messages.spec.ts](../../apps/web/e2e/search-messages.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |

</details>

<details>
<summary>settings-trim — 7 rows</summary>

Baseline anchors: [machine-row.tsx:237](../../apps/web/src/resources/machine-row.tsx#L237), [machine-token-rotation-schedule.ts:46](../../apps/server/src/services/machine-token-rotation-schedule.ts#L46).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [58](../design/settings-trim.md#L58) | Duplicate Settings page/section heading across all 10 Settings sections (`account`, `routing`, `machines`, `skills`, `mcp`, `secrets`, `vault`, `api-keys`, `remote`, `im`) | [settings-trim.test.ts](../../apps/web/test/settings-trim.test.ts), [settings-master-detail.spec.ts](../../apps/web/e2e/settings-master-detail.spec.ts) | — (indexed source/test only) |
| [59](../design/settings-trim.md#L59) | `(i)` `InfoTip` beside `聊天应用` heading (embedded `SettingsDialog` & standalone `PageShell`), tab switch clears `titleMetaSlot`, keyboard/390px touch `InfoTip`, IM loading/empty/error states | [settings-trim.test.ts](../../apps/web/test/settings-trim.test.ts), [settings-master-detail.spec.ts](../../apps/web/e2e/settings-master-detail.spec.ts), [settings-im.spec.ts](../../apps/web/e2e/settings-im.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [60](../design/settings-trim.md#L60) | Runners row menu omits token rotation & reauth drawer; 2 items for default & non-default; `R` no-op; `F`/`D` shortcuts, delete confirm/cancel/error, demo mode, 1440px/390px light/dark | [settings-trim.test.ts](../../apps/web/test/settings-trim.test.ts), [machine-rotate-token.spec.ts](../../apps/web/e2e/machine-rotate-token.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [61](../design/settings-trim.md#L61) | Scheduled automatic rotation rotates online runner in place via `dueEvent` + SSE -> claim -> ack -> handoff while step runs & queued task dispatches | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [62](../design/settings-trim.md#L62) | Offline runner & SSE push failure keep old token valid; reconnect arms rotation after `hello`; normal 7d countdown with <1h left is NOT pulled forward; server restart preserves `dueEvent` | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [63](../design/settings-trim.md#L63) | Online timeout / unresponsive old runner / concurrency cap / claimed-then-timeout / late `ack` vs active round / idempotent `ack` replay / scheduler exception backoff | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |
| [64](../design/settings-trim.md#L64) | Re-registration resets 7d schedule; delete/revoke cancels; concurrent `enrollMachine` / `DELETE` / `armOverdueTokenRotationOnConnect` during in-flight rotation; `syncDueSources` staggered seed/prune; manual API regression | [machine-rotate-token.test.ts](../../apps/server/test/machine-rotate-token.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>sign-in-view-and-toasts — 28 rows</summary>

Baseline anchors: [sign-in-view.tsx:12](../../apps/web/src/components/sign-in-view.tsx#L12), [device-sign-in.tsx:52](../../apps/web/src/resources/device-sign-in.tsx#L52), [toaster.tsx](../../apps/web/src/components/ui/toaster.tsx).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [75](../design/sign-in-view-and-toasts.md#L75) | Pick ChatGPT subscription | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [76](../design/sign-in-view-and-toasts.md#L76) | Starting, slow network (400 ms) | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [77](../design/sign-in-view-and-toasts.md#L77) | Copy pressed | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | holds; extra behavior (`c9455a1bf`) |
| [78](../design/sign-in-view-and-toasts.md#L78) | Open sign-in page | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | holds; extra behavior (`c9455a1bf`) |
| [79](../design/sign-in-view-and-toasts.md#L79) | Sign-in completes (ChatGPT or xAI) | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [80](../design/sign-in-view-and-toasts.md#L80) | Poll returns 404 (server lost the login) | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [81](../design/sign-in-view-and-toasts.md#L81) | Start request fails (502) | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [82](../design/sign-in-view-and-toasts.md#L82) | The user declines the sign-in | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [83](../design/sign-in-view-and-toasts.md#L83) | The code expires before sign-in | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [84](../design/sign-in-view-and-toasts.md#L84) | A newer credential superseded this login | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [85](../design/sign-in-view-and-toasts.md#L85) | Cancel while waiting | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [86](../design/sign-in-view-and-toasts.md#L86) | Escape while waiting | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [87](../design/sign-in-view-and-toasts.md#L87) | Cancel during start, then pick again quickly | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [88](../design/sign-in-view-and-toasts.md#L88) | xAI form sign-in button | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |
| [89](../design/sign-in-view-and-toasts.md#L89) | Sign in again on an expired ChatGPT provider | [providers-subscription-relogin.spec.ts](../../apps/web/e2e/providers-subscription-relogin.spec.ts) | — (indexed source/test only) |
| [90](../design/sign-in-view-and-toasts.md#L90) | First-run inline picker picks ChatGPT | [first-run-setup.spec.ts](../../apps/web/e2e/first-run-setup.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [91](../design/sign-in-view-and-toasts.md#L91) | Devin waiting | [providers-subscription-relogin.spec.ts](../../apps/web/e2e/providers-subscription-relogin.spec.ts) | — (indexed source/test only) |
| [92](../design/sign-in-view-and-toasts.md#L92) | Antigravity waiting in the re-login dialog | [providers-subscription-relogin.spec.ts](../../apps/web/e2e/providers-subscription-relogin.spec.ts) | — (indexed source/test only) |
| [93](../design/sign-in-view-and-toasts.md#L93) | Antigravity waiting in the add dialog and in the subscription detail | [antigravity-local-login.spec.ts](../../apps/web/e2e/antigravity-local-login.spec.ts) | — (indexed source/test only) |
| [94](../design/sign-in-view-and-toasts.md#L94) | Claude add dialog | [providers-claude-subscription.spec.ts](../../apps/web/e2e/providers-claude-subscription.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [95](../design/sign-in-view-and-toasts.md#L95) | The same unhandled failure twice | [query-client-mutation-errors.test.ts](../../apps/web/test/query-client-mutation-errors.test.ts) | — (indexed source/test only) |
| [96](../design/sign-in-view-and-toasts.md#L96) | An unhandled mutation failure | [query-client-mutation-errors.test.ts](../../apps/web/test/query-client-mutation-errors.test.ts) | — (indexed source/test only) |
| [97](../design/sign-in-view-and-toasts.md#L97) | A mutation without `meta` | [query-client-mutation-errors.test.ts](../../apps/web/test/query-client-mutation-errors.test.ts) | — (indexed source/test only) |
| [98](../design/sign-in-view-and-toasts.md#L98) | Server prose with a 404 or 500 | [query-client-mutation-errors.test.ts](../../apps/web/test/query-client-mutation-errors.test.ts) | — (indexed source/test only) |
| [99](../design/sign-in-view-and-toasts.md#L99) | A mutation whose hook or call handles the error in place | [query-client-mutation-errors.test.ts](../../apps/web/test/query-client-mutation-errors.test.ts) | — (indexed source/test only) |
| [100](../design/sign-in-view-and-toasts.md#L100) | Two Undo toasts for two deletions; a toast with an explicit id | [query-client-mutation-errors.test.ts](../../apps/web/test/query-client-mutation-errors.test.ts) | — (indexed source/test only) |
| [101](../design/sign-in-view-and-toasts.md#L101) | New code renders a device code inline, imports sonner, passes `describeError(...)` without `serverText: false` or `.message` straight into a toast call, or adds a mutation without `meta.action` | [ui-guidelines-gate.test.mjs](../../scripts/ui-guidelines-gate.test.mjs) | — (indexed source/test only) |
| [102](../design/sign-in-view-and-toasts.md#L102) | A 390 px wide window | [provider-device-sign-in.spec.ts](../../apps/web/e2e/provider-device-sign-in.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>stall-monitor — 9 rows</summary>

Baseline anchors: [stall-monitor.test.ts:295](../../apps/server/test/stall-monitor.test.ts#L295), [stall-monitor-mappers.test.ts:6](../../apps/web/test/stall-monitor-mappers.test.ts#L6).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [78](../design/stall-monitor.md#L78) | Pending current-turn `ask_user` (worker or Coordinator) or current-turn `actionProposal` card vs stale card from an earlier turn | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [79](../design/stall-monitor.md#L79) | ACP host tools missing (`stallSignal: 'missing_tools'` or legacy `reportTool` error matching `MISSING_HOST_TOOL`) past 30s grace | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [80](../design/stall-monitor.md#L80) | Quota/rate-limit retry loop (`stallSignal` `'quota'` or `'capacity'`) past 60s vs non-quota `attempt >= 2` retry | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [81](../design/stall-monitor.md#L81) | Runner dead/offline (`!online` or `silentSinceDrop`) past 60s grace vs live reconnecting runner (`admitPresence`) | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [82](../design/stall-monitor.md#L82) | Live runner or in-server Coordinator silent past per-runtime quiet window (`antigravity` 3m/6m vs `claude-code` 4m/8m vs `unknown`/null 5m/15m) vs active tool progress | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [83](../design/stall-monitor.md#L83) | Concurrent `finishStep` / `done` / user `stopPending` races with `sweepStallMonitor`, rollback drops post-commit events, and late runner or Coordinator calls after recovery | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [84](../design/stall-monitor.md#L84) | `"local-merge"` step stalls, or step belongs to archived/closed/done todo, superseded build, side chief thread (`chief-digest-*`, `chief-memory-*`), or memory-edit step | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [85](../design/stall-monitor.md#L85) | Deduplication with `sweepWorkerWatchdog`, scheduler wiring, and web chat mapper rendering | [stall-monitor.test.ts](../../apps/server/test/stall-monitor.test.ts) | — (indexed source/test only) |
| [86](../design/stall-monitor.md#L86) | Daemon `ActivityTracker` forwarding + `consumeStepPassEvent` emission + `deliverStop` 404/409 handling | [stall-monitor-signals.test.ts](../../apps/daemon/test/stall-monitor-signals.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>step-roll-forward — 6 rows</summary>

Baseline anchors: [update-repair.ts:76](../../apps/desktop/src/update-repair.ts#L76), [background-update.ts:198](../../apps/desktop/src/background-update.ts#L198).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [33](../design/step-roll-forward.md#L33) | Failed host candidate after marker and accepted writes | [deploy-self.test.mjs](../../scripts/ops/deploy-self.test.mjs) | — (indexed source/test only) |
| [34](../design/step-roll-forward.md#L34) | Only backfill, no domain writes; or unknown probe | [deploy-self.test.mjs](../../scripts/ops/deploy-self.test.mjs) | — (indexed source/test only) |
| [35](../design/step-roll-forward.md#L35) | Already journaled restore is interrupted; live file missing in repair | [deploy-self.test.mjs](../../scripts/ops/deploy-self.test.mjs) | — (indexed source/test only) |
| [36](../design/step-roll-forward.md#L36) | Watcher sees failed active SHA, interrupted repair, no Runner, or stranded claim | [deploy-self.test.mjs](../../scripts/ops/deploy-self.test.mjs) | — (indexed source/test only) |
| [37](../design/step-roll-forward.md#L37) | Resident candidate adds the marker and fails | [background-update.test.ts](../../apps/desktop/scripts/background-update.test.ts) | — (indexed source/test only) |
| [38](../design/step-roll-forward.md#L38) | Desktop later compatible signed release; blocked probe; stale foreground callback | [background-update.test.ts](../../apps/desktop/scripts/background-update.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>subscription-quota — 12 rows</summary>

Baseline anchor: [providers-subscription-quota.spec.ts:53](../../apps/web/e2e/providers-subscription-quota.spec.ts#L53).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [20](../design/subscription-quota.md#L20) | Claude has a window; Antigravity has distinct pools | [providers-subscription-quota.spec.ts](../../apps/web/e2e/providers-subscription-quota.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [21](../design/subscription-quota.md#L21) | ChatGPT weekly-only / 5h and weekly | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts) | — (indexed source/test only) |
| [22](../design/subscription-quota.md#L22) | Devin and Doubao, recent activity | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts), [providers-subscription-quota.spec.ts](../../apps/web/e2e/providers-subscription-quota.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [23](../design/subscription-quota.md#L23) | No Cairn activity | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts) | — (indexed source/test only) |
| [24](../design/subscription-quota.md#L24) | Past reset | [providers-subscription-quota.spec.ts](../../apps/web/e2e/providers-subscription-quota.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [25](../design/subscription-quota.md#L25) | Runner disconnects | [providers-subscription-quota.spec.ts](../../apps/web/e2e/providers-subscription-quota.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [26](../design/subscription-quota.md#L26) | Switch before a slow read finishes | [providers-subscription-quota.spec.ts](../../apps/web/e2e/providers-subscription-quota.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [27](../design/subscription-quota.md#L27) | Another team's account or unauthenticated request | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts) | — (indexed source/test only) |
| [28](../design/subscription-quota.md#L28) | ChatGPT token is missing or expired | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts) | — (indexed source/test only) |
| [29](../design/subscription-quota.md#L29) | ChatGPT returns 401, 429, 5xx or bad JSON | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts) | — (indexed source/test only) |
| [30](../design/subscription-quota.md#L30) | ChatGPT request reaches deadline | [subscription-quota.test.ts](../../apps/server/test/subscription-quota.test.ts) | — (indexed source/test only) |
| [31](../design/subscription-quota.md#L31) | Old server returns 404, or activity read fails | [providers-subscription-quota.spec.ts](../../apps/web/e2e/providers-subscription-quota.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |

</details>

<details>
<summary>task-guidance-plan-2026-11-27 — 10 rows</summary>

Baseline anchors: [acceptance.ts:430](../../packages/shared/src/records/acceptance.ts#L430), [build-step-complete.ts:187](../../apps/server/src/services/build-step-complete.ts#L187).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [77](../design/task-guidance-plan-2026-11-27.md#L77) | Info/doc server acceptance enforces generated deliverable check while permitting gap-marked external sources | [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | replaced in part (`7ea2f2667`) |
| [78](../design/task-guidance-plan-2026-11-27.md#L78) | Historical and current `SESSION_BRIEF` / `SESSION_REWORK_BRIEF` in transcript backfill | [transcript-origin-backfill.test.ts](../../apps/server/test/transcript-origin-backfill.test.ts) | — (indexed source/test only) |
| [79](../design/task-guidance-plan-2026-11-27.md#L79) | `ACCEPTANCE_NUDGE_HEAD` retry prompts in transcript backfill | [transcript-origin-backfill.test.ts](../../apps/server/test/transcript-origin-backfill.test.ts) | — (indexed source/test only) |
| [80](../design/task-guidance-plan-2026-11-27.md#L80) | Normal deliveries (UI live shot, API 2xx/probe, CLI 0 exit, doc checked, info report submitted, read-only no-edit verified) | [acceptance.test.ts](../../packages/shared/test/acceptance.test.ts), [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | replaced in part (`7ea2f2667`) |
| [81](../design/task-guidance-plan-2026-11-27.md#L81) | UI edit with Playwright run but 0 shots, fixture-only shot, pending/failed `attach_file` upload, or shot invalidated by a later edit (`#18`) | [acceptance.test.ts](../../packages/shared/test/acceptance.test.ts), [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | — (indexed source/test only) |
| [82](../design/task-guidance-plan-2026-11-27.md#L82) | API/CLI/doc edit with post-edit command exiting non-zero, hollow prose-only claim, or unchecked/broken deliverable (`#45`) | [acceptance.test.ts](../../packages/shared/test/acceptance.test.ts), [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | — (indexed source/test only) |
| [83](../design/task-guidance-plan-2026-11-27.md#L83) | GitHub task with unpushed commits on HEAD or scanned branch + auth blocker (`#53`/`#54`), unpushed without auth error, git probe failure (`unpushedCommits: null`), vs legacy old daemon (`undefined`) and pushed-not-merged (`0`) | [step-closing-git.test.ts](../../apps/daemon/test/step-closing-git.test.ts), [acceptance.test.ts](../../packages/shared/test/acceptance.test.ts), [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | — (indexed source/test only) |
| [84](../design/task-guidance-plan-2026-11-27.md#L84) | Modified test/check fails locally with `spawn EPERM` before commit and defers to CI (`#38`) | [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | — (indexed source/test only) |
| [85](../design/task-guidance-plan-2026-11-27.md#L85) | User answers blocker `QuestionCard` without unblocking (still failing/unpushed) vs unblocks on resumed step | [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts) | — (indexed source/test only) |
| [86](../design/task-guidance-plan-2026-11-27.md#L86) | Bounded retry ignored again, `pendingWorkerQuestions > 0`, `undeliveredAnswers > 0`, empty transcript, non-build/`failed`/`stopped`/stale build, or daemon journal `/done` replay (`step-final-upload.ts`) | [acceptance-gate.test.ts](../../apps/server/test/acceptance-gate.test.ts), [step-closing-git.test.ts](../../apps/daemon/test/step-closing-git.test.ts) | — (indexed source/test only) |

</details>

<details>
<summary>text-rules — 15 rows</summary>

Baseline anchors: [DESIGN.md:15](../../apps/web/DESIGN.md#L15), [foundation.md:85](../../docs/design/surfaces/foundation.md#L85), [settings-list.tsx:164](../../apps/web/src/components/settings-list.tsx#L164).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [24](../design/text-rules.md#L24) | A new settings row with a helper sentence | [settings-row-status.test.ts](../../apps/web/test/settings-row-status.test.ts) | — (indexed source/test only) |
| [25](../design/text-rules.md#L25) | Backup failed | [settings-row-status.test.ts](../../apps/web/test/settings-row-status.test.ts) | — (indexed source/test only) |
| [26](../design/text-rules.md#L26) | Notifications blocked by the browser | [push-device-switch.spec.ts](../../apps/web/e2e/push-device-switch.spec.ts) | — (indexed source/test only) |
| [27](../design/text-rules.md#L27) | Route override dialog | [thread-route-override.spec.ts](../../apps/web/e2e/thread-route-override.spec.ts) | — (indexed source/test only) |
| [28](../design/text-rules.md#L28) | Light secondary text on a selected or hovered row | [dark-text-tertiary-contrast.test.ts](../../apps/web/test/dark-text-tertiary-contrast.test.ts) | — (indexed source/test only) |
| [29](../design/text-rules.md#L29) | Dark theme | [dark-text-tertiary-contrast.test.ts](../../apps/web/test/dark-text-tertiary-contrast.test.ts), [a11y-axe.spec.ts](../../apps/web/e2e/a11y-axe.spec.ts) | — (indexed source/test only) |
| [30](../design/text-rules.md#L30) | Settings head, section title, row label, status line at 1440 and 390, light and dark | [design-rules-measure.spec.ts](../../apps/web/e2e/design-rules-measure.spec.ts) | — (indexed source/test only) |
| [31](../design/text-rules.md#L31) | Fresh install model-source prompt | [first-run-checklist.spec.ts](../../apps/web/e2e/first-run-checklist.spec.ts) | Fixture suite passed; individual clauses not necessarily exercised |
| [32](../design/text-rules.md#L32) | Tasks panel empty tabs (no tasks, nothing active, nothing next, no schedules) | [chief-home-tasks-panel.spec.ts](../../apps/web/e2e/chief-home-tasks-panel.spec.ts) | — (indexed source/test only) |
| [33](../design/text-rules.md#L33) | Schedule timezone and on-the-hour caution | [schedules-detail.spec.ts](../../apps/web/e2e/schedules-detail.spec.ts) | — (indexed source/test only) |
| [34](../design/text-rules.md#L34) | Other empty states (runners, providers, secrets, vault, API keys, usage, remote access off) | [skills-page.spec.ts](../../apps/web/e2e/skills-page.spec.ts) | — (indexed source/test only) |
| [35](../design/text-rules.md#L35) | Errors and failed actions (backup restore, project conversion, connect failures, schedule save) | [chief-home-backup.spec.ts](../../apps/web/e2e/chief-home-backup.spec.ts) | — (indexed source/test only) |
| [36](../design/text-rules.md#L36) | Lock-screen push button at 390px | [push-device-switch.spec.ts](../../apps/web/e2e/push-device-switch.spec.ts) | — (indexed source/test only) |
| [37](../design/text-rules.md#L37) | Long Chinese title at 18px in a narrow window | [design-rules-measure.spec.ts](../../apps/web/e2e/design-rules-measure.spec.ts) | — (indexed source/test only) |
| [38](../design/text-rules.md#L38) | Empty list with its description removed | [skills-page.spec.ts](../../apps/web/e2e/skills-page.spec.ts) | — (indexed source/test only) |

</details>

<details>
<summary>tier-routing — 9 rows</summary>

Baseline anchors: [tier-selection.ts:76](../../packages/shared/src/tier-selection.ts#L76), [source-tiers.ts:222](../../apps/server/src/services/source-tiers.ts#L222).

| Plan line | Promised case | Evidence path in plan | Baseline status / evidence limit |
|---|---|---|---|
| [77](../design/tier-routing.md#L77) | Empty, all-non-chat, or all-banned catalog | [tier-selection.test.ts](../../packages/shared/src/tier-selection.test.ts), [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [78](../design/tier-routing.md#L78) | Size-differentiated family (`acme-7b` vs `acme-70b`) and 3+ collapsing to 1–2 | [tier-selection.test.ts](../../packages/shared/src/tier-selection.test.ts), [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [79](../design/tier-routing.md#L79) | Short-context (`< 32k`) in 3-model catalog, `$0` vs unpriced, and zero-signal opaque relay | [tier-selection.test.ts](../../packages/shared/src/tier-selection.test.ts), [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [80](../design/tier-routing.md#L80) | 1-model, 2-model, and 3+ sources (API, Antigravity, Claude Code, Devin) | [tier-selection.test.ts](../../packages/shared/src/tier-selection.test.ts), [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [81](../design/tier-routing.md#L81) | Coordinator `difficulty` prompt, `update_todo` refresh, and board/GitHub/legacy tasks | [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [82](../design/tier-routing.md#L82) | Two sources, primary removed/disabled, provider renamed, and pending reorder | [capability-routing.test.ts](../../packages/shared/src/capability-routing.test.ts), [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [83](../design/tier-routing.md#L83) | Pre-claim dead/quota, mid-step 429/quota/`model_unavailable`/auth/outage, stale `step.fallback.model`, quota recovery, and 0-usage retry | [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [84](../design/tier-routing.md#L84) | Old protocol runner, legacy sandbox, old Claude CLI, machine/MCP pin, and total exhaustion | [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts) | — (indexed source/test only) |
| [85](../design/tier-routing.md#L85) | Explicit task pin (`todo.request.model`), `checkpointCommit` continuity, and `merge`/`review` unchanged | [tier-routing.test.ts](../../apps/server/test/tier-routing.test.ts), [model-route-silent-switch.test.ts](../../apps/server/test/model-route-silent-switch.test.ts) | — (indexed source/test only) |

</details>

### Web UI audit (non-plan table)

| Plan row | Status | Evidence |
|---|---|---|
| [44](../design/web-ui-audit-2026-11-28.md#L44) ChatGPT and xAI shared view | holds in source | [Picker branch](../../apps/web/src/resources/create-provider-dialog.tsx#L243) |
| [45](../design/web-ui-audit-2026-11-28.md#L45) no inline server login error | holds in source | [Device login](../../apps/web/src/resources/device-sign-in.tsx#L52) |
| [46](../design/web-ui-audit-2026-11-28.md#L46) Devin awaiting sign-in | holds in source | [Devin subscription](../../apps/web/src/resources/devin-subscriptions.tsx) |
| [47](../design/web-ui-audit-2026-11-28.md#L47) Antigravity waiting rows | holds in source | [Antigravity subscription](../../apps/web/src/resources/antigravity-subscriptions.tsx) |
| [48](../design/web-ui-audit-2026-11-28.md#L48) Claude setup command | holds | [Source](../../apps/web/src/resources/claude-subscriptions.tsx), [passing browser spec](../../apps/web/e2e/providers-claude-subscription.spec.ts) |
| [58](../design/web-ui-audit-2026-11-28.md#L58) generic toast drops server text | holds in source | [Toast wrapper](../../apps/web/src/components/ui/toaster.tsx) |
| [59](../design/web-ui-audit-2026-11-28.md#L59) provider error uses safe title | holds in source | [Provider page](../../apps/web/src/resources/providers-page.tsx) |
| [60](../design/web-ui-audit-2026-11-28.md#L60) unsent toast uses safe body | holds in source | [Unsent feedback](../../apps/web/src/chief/announce-unsent.ts) |

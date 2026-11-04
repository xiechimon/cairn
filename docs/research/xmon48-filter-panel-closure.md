# XMON-48 workbench filter interaction: research wrap-up and decision material

Date: 2026-10-02 · Ticket: XMON-48 (sub-ticket XMON-57 · PR #564 · commit `6f079a81`)
pacman-side verification baseline: `origin/main@4647eaf` (board filter-surface files unchanged since `6f079a81`)
Reference evidence: Multica = line-by-line review of a local source checkout (2026-10-02); todos.dev = archived official llms-full.txt plus a live re-capture of the changelog (2026-10-02).

## 1. Conclusions first

The interaction XMON-48 complained about (clicking through repositories one by one on the left, clicking through types one by one on the right, the two entries unrelated to each other) **was fully fixed and shipped on 2026-10-01**: research → user's 8 rulings → PR #564 merged (`6f079a81`) → CI all green → user confirmed merge. The ticket sits in `in_review` only because Multica was decommissioned before the status was flipped, not because work is unfinished.

This document is the wrap-up record of that line plus decision material for the remaining open items. Only two genuine decisions remain: **whether the local-project type vocabulary can be extended** (recommendation: keep the fixed 6-word list; if ever done, take the hybrid path of "FIXED_TAGS floor + project-level appended words (description required)", with Multica's select custom property as the form reference) and **named saved views `?view=`** (recommendation: do not build — pacman's URL-as-truth already covers most of its value). Sidebar aggregation was ruled out by the user and is archived only.

## 2. Ticket timeline (XMON-48 → XMON-57 → #564)

Times are UTC as recorded by Multica (verbatim archive in the comment section).

| Time | Event |
|---|---|
| 2026-09 (≤30th) | XMON-48 opened: user complains the workbench requires per-item selection of `全部/凭证链路验证/pacman` and types |
| 09-30T23:21Z~23:54Z | Research delivered: Multica source-level + todos.dev docs-level (runtime side see r10/r11) |
| 10-01T05:42Z~07:28Z | User's 6 answers: pain point = top bar, not sidebar; repo axis keeps union; unified filter panel adopted; sidebar stays as-is; saved views deferred; type vocabulary "make it dynamic for me" |
| 10-01 | Plan frozen as 8 rulings (below); PR #564 merged as `6f079a81`, CI green (board-filter 20 passed; dead-buttons/escape-wiring/shadcn-primitives 34 passed; vitest 40; lint/typecheck 0) |
| 10-01T08:26Z | User confirms merge & done; wrap-up comment at 08:31Z |
| after 10-01 | Multica decommissioned (local daemon offline), XMON-48 status never flipped |

### The frozen 8 rulings (XMON-57, all verified shipped, see §3)

1. Pain surface = the board top bar (repo chip group + type popover), **not the sidebar** — `全部-凭证链路验证-pacman` is the render order of the repo chips
2. Repo axis keeps **union selection** + select-all/clear/invert; todos.dev's exclusion model **rejected**
3. Option C adopted: **unified filter panel** (both axes folded into one popover)
4. Sidebar **stays as-is** (option B withdrawn)
5. **No** saved views / `?view=`
6. Type vocabulary **dynamized** (closing ADR 0005 D2)
7. Canonical order = **dictionary order**
8. Same-name-different-color tags → take the color of the **first project in canonical order**

Explicit do-not list: sidebar changes, saved views, the `__none__` sentinel (the always-visible-when-untagged ruling stands), name-heuristic filtering (forbidden by ADR 0005), URL parameter shape changes.

## 3. Current state (code measured 2026-10-02, file:line against origin/main@4647eaf)

**Top bar layout** `apps/web/src/board/board.tsx:338-351`: `FilterChips` on the left (the active-filter strip, a standalone container, not entering `board-topbar-actions` — the dead-buttons e2e pins the right action area to exactly one button); a single `FilterPanel` button on the right. Title absolute + pointer-events-none so it does not intercept clicks.

**Unified filter panel** `apps/web/src/board/filter-panel.tsx` (321 lines):
- Trigger button: ghost Button + Funnel icon + selected-count badge (:263-320; selector aliases `board-type-filter`/`type-filter-popover` kept per the alias-priority rule of #411)
- Per dimension (repo/type): header with "name + selected n/m + select all + clear" (disabled states, stable positions); a search box appears above 8 items (`SEARCH_THRESHOLD = 8`, :41); `role=listbox aria-multiselectable`, max-h-[220px]; hover reveals a `仅此` ("only this") button (only when something is already selected); each item's count = hits **after the other axis narrows** (this axis excluded, otherwise everything becomes 0 after one selection)
- Empty-vocabulary state: `本作用域内没有可选的仓库/类型` ("no selectable repos/types in this scope")
- Bottom `清除全部` ("clear all") appears only when >1 item is selected; clicking an option keeps the panel open; the query resets each open/close cycle

**Type vocabulary dynamized** (rulings 6/7/8 landed):
- `apps/web/src/api/hooks.ts:140-165` `useProjectTags` produces `{tagById, nameById, ordered[], ready}`, ordered by projectIds order (= dictionary canonical order) — ruling 8 "same name takes the first project's color" is guaranteed by the projection order
- `apps/web/src/board/tag-filter.ts:43-47` `parseTagParam(raw, vocab)`: vocabulary-not-ready gate, dedup + intersection + dictionary order; :52-63 `matchesTagFilter`: empty selection = show all, **untagged tasks always visible** (ruling kept); :70-95 `buildTagOptions`: first-color-wins, other-axis counts, dictionary order
- `apps/web/src/routes/board-page.tsx:113,128-132` wiring; :225-227 select-all writes `[...tagVocab].sort()` (batch-key semantics = write the full vocabulary, readout N/N instead of 0/N)
- Card tags are resolved from **per-project tag records** (`cardTag`), no longer hardcoded FIXED_TAGS

**Repo axis** `apps/web/src/board/repo-filter.ts`: the union model is kept (the module header comment records the rejection of the exclusion model); `parseProjectsParam` preserves unknown ids (:36-39); `buildRepoOptions` entry order = row order (:52-67).

**FIXED_TAGS is still the 6 words** (by design, see §8.1): `packages/shared/src/task-meta.ts:28` (bug/feature/improvement/refactor/docs/chore, each with description and color); `apps/server/src/services/tags.ts:19` `seedFixedTags`, :48 `backfillFixedTags` (github-form projects skip :51), :83 `syncGithubLabels` (github projects mirror real repo labels = naturally dynamic), :127 `resolveProjectTagIds`; `apps/server/src/services/machines.ts:1183-1184` `set_task_meta` allowlist validation (local/hosted = FIXED_TAGS + single tag).

**Empty state** `apps/web/src/board/board.tsx:378-393`: `board-filter-empty` + `没有匹配筛选条件的任务` ("no tasks match the filter") + a named summary of active filters (answering "where did my cards go") + a `清除筛选` button.

**Sidebar**: untouched (ruling 4) — no `全部项目` aggregation row in `sidebar.tsx` (grep zero hits).

**e2e** `apps/web/e2e/board-filter.spec.ts`: 20 cases, including the batch key (:389 `select all = write the full vocabulary (readout N/N, not 0/N); 『仅此』 collapses to a single value`), the active-filter strip (:413), card chips (:447), URL canonical order, empty state, direct parameter entry, two-axis AND.

**Another `全部`**: the single-select status menu inside the project page (all/in-progress/done, `apps/web/src/pages/project-page.tsx:201-205` `TASK_FILTERS`) is unrelated to the board top-bar filter; XMON-57 §0 already ruled it out of scope.

## 4. Why it used to be unreasonable (root causes of the pre-#564 pain)

The old state = two independent controls invented by pacman #403/#445 (repo chip group on the left + type popover on the right), a replication of no reference implementation:

1. **One logical operation split into two entry points**: filtering "a type in a certain repo" required walking back and forth across the two sides of the top bar, and neither control knew the other's state
2. **No cross-axis counts**: options did not show "how many would remain if I select this"; you could only pick blindly and then count cards
3. **No batch keys**: no select-all/clear/invert/`仅此`; N repos took N-1 clicks to express "everything except X"
4. **Chip render order carried no semantics**: `全部-凭证链路验证-pacman` sorted by row order, making `全部` look like a third option rather than a state readout (the direct source of the user's complaint)
5. **Type vocabulary hardcoded**: FIXED_TAGS was written into the UI layer, so real labels of github projects could never reach the type axis (the ADR 0005 D2 gap)

#564's fixes correspond one-to-one to the root causes: single panel (1), other-axis counts (2), select-all/clear/only-this (3), chips became the active-filter strip + count badge (4), vocabulary dynamically projected from per-project tag records (5).

## 5. How Multica actually does it (source level)

Sources: line-by-line re-review of the local source (2026-10-02, file:line against the current working tree) + XMON-57 research (github.com/multica-ai/multica @`43b0571f`, 2026-10-01). Core UI lives in `packages/views/*`, state/types in `packages/core/*`.

**Sidebar = flat grouped navigation, no repo tree** (`packages/views/layout/app-sidebar.tsx`):
- Top to bottom: Workspace switcher (:616-746) / search slot + New Issue (:747-768) / Inbox·My Issues·Chat (:147-151) / Pinned collapsible group (drag to reorder, :811-858) / Issues·Projects·Autopilots (:153-157) / Agents·Squads·Skills·Runtimes (:159-164) / Usage·Settings (:166-169). Each item is a one-click route hop, no drill-down
- **`全部` ("all") = the workspace-level Issues aggregation board** (zh copy `all_label` = `全部`, `packages/views/locales/zh-Hans/issues.json:146-147`); a repo is just a project attribute (`packages/core/types/project.ts:64-67` `github_repo|local_directory`), it does not enter the sidebar
- Three scope granularities: workspace aggregation (Issues) / project detail page (`project-detail.tsx:551`) / personal (My Issues). "Look at only a few repos" = multi-select the Project facet, not per-item sidebar clicks
- ViewBar (`view-bar.tsx`; `issues-header.tsx:1300-1360`): built-in scope tabs (All/Members/Agents, single-select radio semantics, `issues-scope-store.ts:8`) and saved views mixed into one draggable flat row, in the content area, not the sidebar

**Filtering = a single funnel menu + a second-level submenu per dimension, multi-select on all dimensions** (`issues-header.tsx` + `view-store.ts` + `filter-chips-bar.tsx`):
- Trigger button (`issues-header.tsx:2063-2085`): outline + "Filter" when no filter, brand background + "N filters" count when filtered
- Dimensions: status / priority / assignee / creator / project / projectStatus / label / `property:<id>` (`FilterDimension`, `view-store.ts:137-145`) + dateFilter, agentRunningFilter (:96-100, 242-272)
- Multi-select via checkbox per dimension (`DropdownMenuCheckboxItem` + `toggle*Filter`, `view-store.ts:420-490**); **OR within a dimension, AND across dimensions** (stated in the comment at :251-264)
- Each option carries a match count (`filters.issue_count`; server-side facets, verified by XMON-57 at `issues-header.tsx:204-255`); long lists (assignee/project/label) embed a search box in the submenu (:345-370, 527-541, 662-674); assignee supports pinyin and grouping by Members/Agents/Squads
- **No within-dimension "select all" button**; there is a global "Reset all filters" (:1857-1874, resetting to the view baseline inside a saved view) + Clear at the right end of the chip strip (`filter-chips-bar.tsx:586-589, 675-683`)
- Chip strip: one chip per active dimension (icon + dimension name + "first value +N" summary + up to 3 stacked icons + a per-dimension remove X; :44-64, 594-640); the whole strip is not rendered when no filter (:672)
- Three-stage empty state (`issue-surface.tsx:302-329`, verified by XMON-57): "empty from filtering ≠ truly empty"

**The "type" vocabulary — Multica has no built-in issue type** (no type field in `packages/core/types/issue.ts`): it is played by **select-type custom properties** — filterable by multi-select (`togglePropertyFilter`, `view-store.ts:480-490`), usable as board grouping columns (`IssueGrouping` includes `property:${string}`, :20-24), with a picker at creation (`create-issue.tsx:95` → `custom-property-picker.tsx`). The vocabulary is entirely user-defined per workspace.

**Two-layer persistence**:
- Ordinary filters = workspace-level localStorage (zustand persist key `multica_issues_view`, `view-store.ts:658-706`; partialize excludes dateFilter/agentRunningFilter :661-667; cleared on workspace switch :836-847) — **not in the URL, not shareable**
- Saved views = 10-field `FilterSnapshot` (:120-133) stored server-side, `?view=` URL two-way sync (`use-issue-view-url-sync.ts`), pinnable into the sidebar; locked dimensions show checked-and-disabled in the menu (`active-view-store.ts:38-60`)

**Keyboard**: Cmd/Ctrl+K command palette, C to create an issue, Cmd+B to collapse the sidebar (`shortcuts/definitions.ts:80-82`); navigation actions are rebindable (:111-122); no default hotkey for filter dimensions [inference].

**Mapping to XMON-48**: neither complained-about surface exists in Multica as "per-item single-select" — the sidebar replaces per-repo clicking with "aggregation board + multi-select Project facet"; the "type" is naturally a multi-select checkbox facet.

## 6. How todos.dev actually does it (docs level)

Sources: official `llms-full.txt` full archive (32 docs, captured 2026-09-30, verified consistent segment by segment) + live changelog re-capture (agent-reach, through 09-30, no drift). All doc text, no screenshots; behaviors behind the login wall are marked item by item.

**Navigation**:
- Object hierarchy Team → Project → Todo; "Workspace" is the name of the homepage, not a hierarchy level (docs/chief#the-workspace)
- **The homepage is the aggregation view**: the Chief conversation + the whole-team cross-project board side by side, `全部` is the default state at zero clicks; sidebar project rows are just shortcuts to project pages
- Sidebar (pieced together from the changelog [inference]): team row / New task / Workspace / board entry (/inbox, the full-page board) / Projects section (**first 5 + Show all (N)**, pins synced at account level, 08-28, 09-03) / Resources section (Connections·Machines·Providers·Secrets, 09-30) / Schedules / ⌘K. On 09-30 the sidebar became drag-resizable 200-400px, collapsing into an icon bar past the threshold
- Navigation stack: sidebar jumps reset the stack, Back always returns to the board (09-26); entering a project page = 1 click

**Types**:
- **Todos have no type field**; there is only one kind of unit of work (docs/concepts#todo)
- The "type filter" in the docs = **in-column phase sub-facets**: the Needs you column "plan awaiting confirmation vs changes awaiting acceptance", the In progress column "planning vs building" (changelog 09-25, 09-26)
- **Tags are the only user-defined classification**, with a "filter the board by it" capability (docs/projects#tags); single/multi-select form [not verified]; the board-level filter menu has no tag dimension (the 09-26 dimension list is complete = Created by + Projects)

**Filtering**:
- Board filtering was born on 2026-09-25/26: 09-25 gave each column its own header filter menu; 09-26 moved project filtering **up** into a single filter icon at the board's top right, merged with Created by into one menu acting on all columns
- Projects = **checkbox multi-select, all checked by default, new projects checked by default** (09-26); Created by = just me / Chief or agent / other members, the control form not stated in the original text, wording leans single-select [inference]
- Two layers of filtering: board-level + column-level are independent; the mobile filter sheet rows carry checkboxes (09-26)
- URL persistence [not verified] (zero mentions across the full changelog 06-04→09-28); saved views judged nonexistent [inference] (zero mentions across docs + 117 changelog entries)
- Empty state: only the "column empty" copy was measured (Needs you = `Nothing waiting on you`); the filtered-to-bottom empty state [not verified]

**Batch operations** (evidence that "per-item selection" never held in todos.dev at any time): 06-17 card checkboxes drive batch selection → 07-06 bulk menu (complete/copy-link/merge) → 09-12 Ctrl/Cmd multi-select drag (incompatible cards auto-skipped with a count report) → 09-27 multi-selected cards dragged into Chief become todo chips → 09-29 batch complete (checks mergeable changes first, one confirmation).

## 7. Three-way comparison table

| Axis | pacman current (post-#564) | Multica | todos.dev |
|---|---|---|---|
| Filter entry | top-bar single `筛选` button + unified panel (2 axes flat) | single Filter button + second-level submenu per dimension (~10 dimensions) | single icon at board top right + independent per-column menus |
| Repo/project axis | union multi-select + select-all/clear/only-this | multi-select checkbox (no per-dimension select-all, global Reset) | checkbox multi-select, all checked by default (exclusion model) |
| Type axis | dynamic vocabulary projection, multi-select + batch keys | no built-in type; select custom property multi-select | no type field; "type" = in-column phase sub-facet |
| Per-option counts | yes — hits after the other axis narrows | yes — server-side facets | no (no mention in docs) |
| Active-filter readout | chips strip + trigger-button badge | chip strip (first value +N, per-dimension remove) + N filters | [not verified] |
| Untagged/uncategorized | always visible (ruling kept) | `__none__` sentinel + includeNoAssignee/Project | tags filterable, form [not verified] |
| Empty state | named summary + clear filters | three-stage (filtered-empty ≠ truly empty) | only "column empty" copy verified |
| Shareable URL | yes — all parameters canonicalized | only saved view `?view=`; ordinary filters in localStorage | [not verified] |
| Saved views | none (ruling 5 deferred) | server-side FilterSnapshot + `?view=` + locked dimensions | judged nonexistent [inference] |
| Sidebar aggregation row | none (ruling 4) | none (Issues is the aggregation board) | none (homepage is the aggregation) |
| Sidebar anti-bloat | project rows listed flat | Pinned manual pins | first 5 + Show all + pins |

**Reading**: pacman has reached or exceeded both references on three points — counts, batch keys (per-dimension select-all/clear/only-this, which Multica lacks), and shareable URLs (stronger than Multica's transient localStorage layer); the only things unique to Multica and absent from pacman are **named saved views** (§8.2) and more filter dimensions (pacman having only two axes is a product-shape decision, not a defect); todos.dev's unique sidebar anti-bloat (first 5 + Show all + pins) was closed by ruling 4 and is archived only.

## 8. Remaining open items and options

### 8.1 Whether the local-project type vocabulary can be extended (the only genuinely open product decision)

**Facts**: the vocabulary is dynamic at the UI layer (ruling 6), but the **content of the local/hosted-project vocabulary** is still the FIXED_TAGS 6 words (`task-meta.ts:28`; ADR 0002 D4 intentionally fixed: tag descriptions enter the worker prompt for classification, and the wider the vocabulary, the blunter the classification). Github-form projects already mirror real labels (`tags.ts:83`) and are naturally dynamic. XMON-57's frozen wording: "tell me whenever you want it".

**Reference implementation**: Multica's answer is "type = user-defined select property" (§5) — proof that an open type vocabulary has a mature form (picker values + multi-select facet + usable as grouping columns). But Multica's properties do not carry the worker-prompt classification duty; pacman's FIXED_TAGS descriptions are part of the classification chain and cannot be wholesale copied; what is borrowable is the **form** (project-level definition + picker + multi-select facet).

**Option A (recommended): keep the 6 words fixed**. Cost = 0. ADR 0002 D4's rationale has not been overturned by any new fact; the "dynamic" the user asked for in the 6 answers is already delivered at the UI layer by #564 (github-project vocabularies do move with the repo). Risk = if the user wants custom types for local projects, the demand will reopen — then take C.

**Option B: per-project custom types (fully open, Multica's form copied wholesale)**. Touch surface: CRUD in `tags.ts` + allowlist opened at `machines.ts:1183-1184` + worker-prompt classification quality (custom words without descriptions or with poor descriptions → classification drift, which is exactly ADR 0002's core concern) + existing-data migration + a management entry point in the type-axis UI. Cost = high (server + prompt chain + UI, three sides), and it directly conflicts with the architectural rationale of "feed classification a fixed vocabulary".

**Option C: hybrid — FIXED_TAGS floor + project-level appended words (description required)**. Appended words must carry a description field (to feed the prompt, borrowing Multica's property-picker form); the `set_task_meta` allowlist becomes FIXED_TAGS ∪ the project's appended set. Cost = medium; keeps the classification-quality guardrail; does not break existing data; the vocabulary UI layer is already dynamic, so the frontend needs zero changes (appended words enter the projection automatically). If this is ever built, it is the lowest-risk path.

**Recommendation**: A (status quo), with the B/C trade-off archived as above; when the user names it, go straight to C without further research.

### 8.2 Named saved views `?view=`

**Facts**: the user already ruled "not for now" (5th of the 6 answers). Key gap awareness: pacman's **URL-as-truth already makes any filter combination shareable and bookmarkable** (`?projects=&tags=` canonical order + replace write-back), which is **stronger** than Multica's transient filters (localStorage, not shareable); what Multica really adds is only "naming + server-side storage + one-click switching + locked dimensions" (§5 two-layer persistence). todos.dev is judged to have no saved views at all.

**Option A (recommended): keep not building it**. Cost = 0; browser bookmarks already cover most scenarios; no server-side storage or migration burden. Evidence to reopen = the user exhibiting real usage of "retyping / repasting the same combination over and over".

**Option B: server-side named views (Multica model)**. Needs a views table + CRUD + `?view=` parsing + a priority ruling against the existing parameter axes (when a view conflicts with explicit `?projects=&tags=`, who wins — Multica's answer is checked-and-disabled view-locked dimensions, borrowable) + a pin entry point. Cost = high; benefit = multi-device sync + team-shared views. If built, Multica's two-layer model is the only verified reference implementation.

**Option C: localStorage named views**. Cost = low, but unusable across devices — precisely the weakness of Multica's transient layer; building it would be half-hearted, with no independent value.

**Recommendation**: A; evaluate B directly when the time comes (C excluded).

### 8.3 Sidebar aggregation (ruled, archived only)

User ruling 4 "keep as-is"; neither Multica's nor todos.dev's sidebar has a `全部项目` aggregation row (§5/§6) — pacman's current state matches both references, and both put `全部` in the content area (Multica = the Issues route, todos = the Workspace homepage) rather than the sidebar. If project counts ever bloat, todos.dev's "first 5 + Show all (N) + pin" is a verified reference implementation (changelog 08-28, 09-03). No action item.

### 8.4 Ticket wrap-up

XMON-48 sits in `in_review`. This research ran as a read-only thread (Multica write operations are out of bounds, and the local daemon is decommissioned); **this document is the wrap-up record**. Once the Multica write channel is restored (or a session with permission flips it), set `done` or archive — no code action.

## 9. Verification standard

- **Measured** (2026-10-02, pacman `origin/main@4647eaf`): every file:line in §3 checked one by one; FIXED_TAGS / tags.ts / machines.ts anchors re-checked by grep; zero hits for sidebar aggregation rows; e2e case counts and key assertion wording verified verbatim
- **Source-level evidence** (§5): Multica local source re-reviewed line by line (2026-10-02), file:line against the current working tree; one empty-state spot reuses XMON-57's verification @`43b0571f` (the same section shows no change in the local working tree)
- **Docs-level evidence** (§6): todos.dev official docs full archive + live changelog re-capture; behaviors behind the login wall are marked [not verified], pieced-together spots marked [inference]; nothing fabricated
- **Not done**: live walkthrough of the running app (a research ticket does not start services; #564 ships with green CI + a screenshot evidence chain, see the XMON-57 comment section)

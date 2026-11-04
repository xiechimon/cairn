# Detail page 3-pane structure and right-pane views (detail-right-pane, #366)

The detail route `/app/todo/:id` is a three-pane abutting layout: 240 sidebar | fluid thread column | 488 right pane. The right pane's head type select (the `方案▾`/`变更▾` family) switches between four views: the doc surface (DocPane plan/changes/diff) and three static sections, `分支与 PR` / `Token 用量` / `运行历史` (the #68 head-icon popovers became pane content and no longer open modals). Fresh phases (todo/queued/closed) render no right pane at all, and the 488 goes to the center column's task brief (XMON-55 P0 #563). detail-head keeps only the `更多` icon plus the phase primary button; the composer is the center column's only 12px rounded card.

## Sub-features

- `three-pane-geometry` three columns abutting: 240 | fluid (712 at a 1440 viewport) | 488, 1px hairline seam, no shadows.
- `head-single-icon` the detail-head icon group shrinks to a single `更多` icon (the branch/token/history three icons are out of the ledger); the more-menu popover (#66) behavior is unchanged, the frozen anchor moves right with the header geometry.
- `no-detail-tabs` the document|chat tab group does not exist on any of the nine phase surfaces (the PHASE_UI.tabs field is deleted).
- `pane-view-select` the type-picker button opens a 4-row listbox (the document row = phase-derived `方案`/`变更` + the three section rows), a row click switches the view and closes it (the lang-dropdown rule); a todo with no build payload lists only the document row (no dead rows left).
- `doc-surface` the DocPane plan/changes/diff behavior is unchanged (version chip / compare menu / show full file); the head always renders (the empty state enters the body), the type-picker button is always reachable.
- `branch-section` the `分支与 PR` section = the original dialog sync-tab field components shared (BranchSyncFields/SyncButton) + the PR rows merged into the tail; the live discriminant is the same as branch-sync.md.
- `token-section` the `Token 用量` section: total / model / four statistic rows rendered statically.
- `history-section` the `运行历史` section: run rows (glyph + current chip + meta); the original dialog footer's rerun close-stub is out of the ledger (the failed-phase header primary button carries the real action).
- `fresh-no-right-pane` fresh phases do not render the right column at all (XMON-55 P0 #563: all three sections need a build payload, and the document surface is only an empty placeholder without a build); the three-column geometry is pinned on the thread surface.
- `composer-sole-card` the composer anchors the center column with 16px padding, 12px rounded corners + recessed fill, and is the center column's only card; the chief FAB hugs the center column's bottom-right corner and yields upward when the composer is present (the #347 rule stays).
- `meta-machine-pin-note` the plan-empty-state meta block's machine row gains a reassignment tail note (#1208): the task pins a machine (todo.machineId) and the machine-row value has a different name (the only real-world source = a run_builds explicit machineId reassignment; the dispatch-surface pin is a hard constraint, another machine cannot claim it) -> a `（任务钉选 {machine}）` tertiary tail note on the row end, a machine switch is no longer silent at the board layer. Compliant (same name) and unpinned = zero noise; the pinned-machine-offline waiting annotation `（等待机器上线）` is an adjacent independent tail note (#682). Driving: drive-1208-machine-pin.mjs.

## How to get to it (user POV)

- Any task detail route `/app/todo/:id` (board card title click / search result row / direct URL).
- Right-pane view switching: the pane-head type-picker button (showing `方案▾`/`变更▾` on the document surface, the section name ▾ on section surfaces) -> a listbox row click.
- Driving (`vp.mjs list detail-right-pane` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive detail-right-pane detail-css-live`: the detail page's three columns and right-pane live CSS surface; also needs a real daemon (see the preconditions below); also needs a stub LLM.
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive detail-right-pane detail-live-migration` (the selectors it reads are no longer in apps/web/src); `vp.mjs drive detail-right-pane machine-pin` (agent creation without machineId, 400 since ADR 0019); `vp.mjs drive detail-right-pane three-pane` (the selectors it reads are no longer in apps/web/src).

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS. **No daemon needed** — the structural surfaces are unrelated to step execution (without a daemon the build stays queued, enough to drive all views).

- **How to run.** `node <skill>/scripts/drive-detail-pane.mjs` (self-contained seed: the API directly creates provider/agent/project/todo, verifies the fresh surface first, then POSTs a build to verify the thread surface).
- **Truth.** All checks green: the fresh surface's left-center abutment + no right column + the header single icon, the thread surface's three-column geometry (240/488/abutting), the tab group's non-existence, the 4-row listbox, the branch section's live discriminant (`button[aria-haspopup=listbox]` picker + `getByLabel('同步目录')` + the branch name conv-<buildId>; since #951 the .dlg-machine-picker/.dlg-dir--input class hooks are retired), zero `.dlg` modals across the whole run, the API's `todo.latestBuildId` + SQLite todo/build rows dual truth; screenshots 01-06.
- **The fixture surface** (the r7-16/17b/23 scenario frozen surfaces + the composer card geometry) belongs to the apps/web e2e `detail-3pane.spec.ts`, not this harness.

## Gotchas

- The branch section's live/fixture discriminant shares branch-sync.md's pitfall: a call site omitting buildId silently falls back to the placeholder UI, and the UI shows no error.
- Without a daemon the phase stays queued -> the composer does not render (PHASE_UI[queued].placeholder = null) — the composer geometry is pinned by the fixture e2e, this probe does not pin it.
- For worktree lanes pass `VERIFY_REPO_ROOT` (the stack runs the worktree's code); the evidence landing and archive discipline are in SKILL.md.
- vite's `preview.proxy` inherits `server.proxy` by default: when the fixture e2e runs a route without a scenario parameter, if another lane's dev server is on the local 8787, the live queries hit it and contaminate the empty-state assertions (#366 measured the api-keys empty state being displaced by a real key list). Isolation method: start playwright with `CAIRN_DEV_SERVER_PORT=<a free port>` so the proxy points at nothing.

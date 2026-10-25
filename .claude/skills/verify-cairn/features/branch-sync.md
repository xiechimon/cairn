# Branch sync (detail page right pane branches & PR section, #319/#328/#366)

Users sync a build's worktree branch to a target machine: pick a machine pill -> (optional) force-sync toggle -> click the `同步` button -> `POST /api/builds/{id}/branch-sync` -> the daemon performs the git/worktree sync -> the team-stream `branch_sync` event migrates the result card (pending -> running -> synced/failed). Spec source: r1 changelog 09-13 + booklet 08 appendix B. **Since #366 the detail-page entry = the right-pane type-picker button -> the `分支与 PR` static section (the header-icon popup retired); the popup form survives only as the board-card entry (branch-dialog, `同步到机器|Git` segmented control).**

## Sub-features

- `detail-pane-branch-section` the detail-page right-pane type-picker button (`.doc-select-wrap .doc-pane-select`) opens the pane-view listbox, the `分支与 PR` row switches to the static section: machine pill + sync directory + force toggle + result card + inline sync button + PR rows (#366).
- `branch-dialog-sync-tab` the board card's branch icon opens the branch-dialog, `同步到机器|Git` segmented control, the sync tab carries the same fields as above.
- `machine-select-live` the target-machine pill selects via useMachines truth (online machines selectable only); the fixture surface placeholder is not clickable.
- `sync-post` the `同步` button -> `POST /api/builds/{id}/branch-sync` (server branch_sync table + state machine).
- `sync-daemon-exec` the daemon receives the team-stream sync dispatch -> performSync executes the git/worktree sync.
- `sync-result-card` the result card migrates with branch_sync events: pending -> running -> synced/failed.
- `sync-any-member` any team member can use it (not just the owner).

## How to get to it (user POV)

- Detail page: the right-pane header type-picker button (`方案▾`/`变更▾`) -> the listbox `分支与 PR` row -> the static section (no popup).
- Board: the card branch icon (`button[aria-label="分支与 PR"]`) -> branch-dialog -> the `同步到机器` tab.
- Driving: this feature has no current case; all registered ones are judged stale and refuse to run without `--force` (the refusal prints the reason), `vp.mjs list branch-sync` lists the usage:
  - `vp.mjs drive branch-sync sync-ui`: its dependency setup-branch-sync-seed.mjs creates the agent without machineId, 400 since ADR 0019.

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS.
2. The sync execution needs a real daemon (an online machine) + a build with a worktree branch; live surface.
3. Seed a todo with a build + enroll a machine (same daemon guard as stop-button).

- **How to run.** `setup-branch-sync-seed.mjs` builds the scene (API-creates provider/agent/project/todo/build + builds a **real git scene** in /tmp: a bare origin at C1 -> C2, the target clone parked at C1 with uncommitted changes + untracked files; and sets the build's `step.checkpointCommit` to C2). Start a real daemon with the seed's output `apiKey`: `pnpm exec tsx src/cli.ts start --foreground --api-key <k> --team <teamId> --server http://127.0.0.1:<port>` (missing `--team` reports machine not enrolled). Then `node <skill>/scripts/drive-branch-sync.mjs <todoId> <buildId>`.
- **Sync path.** Detail-page right-pane type picker -> `分支与 PR` section -> pick the machine pill -> fill the sync directory -> turn on force sync -> click `同步` -> result card pending -> running -> synced.
- **Truth.** `POST /api/builds/{id}/branch-sync` 200; the SQLite branch_sync table has a row (migration #328); the result card's terminal state is synced; **the target directory is really git-reset** (HEAD == checkpointCommit + clean worktree + untracked files force-removed) — the target was dirty beforehand, so "it was already clean" cannot slip through.
- **The daemon's initial state eats the plan step.** The moment the daemon connects it claims and runs the build's plan step; an unreachable stub provider -> the step fails and the todo drops to the failed phase. **This does not affect the sync**: `canSync = buildId !== null && live`, independent of the phase; checkpointCommit is likewise untouched.

## Gotchas

- Sync is a daemon execution surface (git/worktree operations), pure server seeding is not enough — a real daemon must be online + the build must have a syncable branch.
- The result card migrates via team-stream SSE events (pending -> running -> synced/failed), not a one-shot response; the drive must wait for the terminal state.
- The fixture-surface sync button is not clickable (placeholder UI, r7); only the live surface is wired.
- Machine selection walks useMachines truth, only online machines are selectable.
- **The caller must pass `buildId`** (measured pitfall): the branch-sync surface's `buildId` is prop-only, the data layer exposes only { live, teamId }, the current todo's build cannot be derived. When either call site (todo-detail-page's RightPane BranchSection / board-page's BranchDialog) omits it, `canSync` is permanently false -> the sync surface stays at the r7 placeholder UI forever (machine pill not clickable, directory read-only, sync button disabled), and **the UI shows no error at all**, very easily mistaken for "by design". Measured when the M7 closing re-probe stepped on it (PR #328 left only server wire tests, no web e2e / integration coverage of this wiring).
- **Verification state (2026-09-28)**: the main-repo live re-probe is in — `drive-branch-sync.mjs` 15 checks all green, evidence archived at `docs/verify/319/2026-09-28T11-32-32-777Z-branch-sync/`. **The CI regression pin is also in**: `integration/test/m7-branch-dialog-e2e.test.ts` runs the detail page against a real stack, asserting the live surface (the machine-picker button `button[aria-haspopup=listbox]` clickable + the directory `getByLabel('同步目录')` input) rather than the fixture placeholder (a disabled placeholder button + a read-only div; the picker and the placeholder are mutually exclusive branches of the same ternary, a clickable picker means the placeholder is absent) — the discriminant is equivalent to "the call site passes buildId", an omission must go red (a regression falsification was done). #951: the original `.dlg-machine-picker` / `.dlg-dir--input` / `.dlg-machine[disabled]` class hooks retired with the detail/overlays.css zeroing, the carriers migrate to the #910 semantic system (migrated in the same round for the probe and the integration m7). That case does not cover real sync execution (needs an online machine); that surface still belongs to this map's `drive-branch-sync.mjs`.
- **#366 entry-migration note (2026-09-29)**: the detail-page header-popup entry retired, the drive script and the integration pin both reroute through the right-pane type picker -> `分支与 PR` section; the field components below the section (BranchSyncFields/SyncButton/result card) are shared with the dialog from the same source, the DOM discriminant is unchanged. The archived evidence in `docs/verify/319/` is in the old entry form, defer to this file's path descriptions when reviewing; the full-chain daemon-execution live re-probe after #366 is pending (preconditions unchanged: seed + real daemon).

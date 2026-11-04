# New task (board)

Users turn a thing on the board into a persisted task: click `新建任务` to open the dialog, **write only the body** (single field, no title input — spec 15 #394), save, and the card lands in the `待开始` column; the title = the first non-empty line of the body, truncated (a placeholder title, backfilled with the official title by the executing agent via `set_task_meta` after taking the task, ADR 0002); on a fresh DB with no project the system auto-creates the `默认项目` and lands the task under it (todo -> project, two hops, imperceptible to the user).

## Sub-features

- `board-render` the workbench shell (renamed at #351 + converged to 4 columns) renders exactly 4 columns (`待开始`/`执行中`/`待处理`/`已完成`), column-head id <-> name pairs match, retired column names (`规划中`/`待确认`/`待验收`) occupy no column, the collapsed family (button / slim bar / folded state) has no render slot, the 4 columns are equal-width with no horizontal scrolling on desktop.
- `newtask-open` the sidebar `新任务` row (`.sidebar-new-task`, the topbar `+ 任务` button removed since #445) opens the dialog (`.new-task-dialog`, **single-field body textarea `.new-task-spec`**, placeholder = the five-line template family; no title input / no tag row).
- `newtask-gate` the gates of `保存` (`.new-task-save`) and `保存并开始` (`.new-task-start`) = non-empty body (both buttons disabled on an empty body).
- `newtask-save` `保存` lands the card; `保存并开始` also starts a build after creating the card (dispatches to an Agent, behavior with no Agent not covered, do not verify by default).
- `newtask-placeholder-title` the placeholder title = the first non-empty line of the body, <= 50 characters + ellipsis on overflow (server-derived, shared `derivePlaceholderTitle` single source; the fixture surface follows the same rule).
- `newtask-autoproject` with no project, the `默认项目` is auto-created (hosted) and the task hangs under it.
- `newtask-persist` the card's triple truth: visible on the board + a `GET /api/todos` row + a SQLite `todo` table row.

## How to get to it (user POV)

- The sidebar `新任务` row or the C hotkey (the key changed from N to C at XMON-41; the topbar `+ 任务` button removed since #445, the row click and the hotkey are the same opener; the detail page / chief get separate tickets).
- Driving (`vp.mjs list board-new-task` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive board-new-task new-task`: the sidebar `新任务` row opens the dialog, save: card on the board + API + SQLite.
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive board-new-task board` (the board-title element it waits for was deleted with #1375); `vp.mjs drive board-new-task overlay-css-migration` (the selectors it reads are no longer in apps/web/src).

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` stack up (fresh DB), `doctor.mjs` fully PASS.

- **Rendering.** Open `/app`, the workbench appears. Run `node <skill>/scripts/drive.mjs board`. 4 `.board-column` columns (`待开始`/`执行中`/`待处理`/`已完成`) + `.sidebar-new-task` visible, evidence `01-board.png`.
- **New task.** Click `新建任务` -> fill the body (the first line is the task's one-liner) -> click `保存`. Run `node <skill>/scripts/drive.mjs new-task`. It walks the full chain: dialog opens -> body on screen -> the card lands in `[data-column-list="todo"]` with `#seqNum` and title = first line -> `GET /api/todos` finds that title with `phase=todo` -> SQLite `SELECT id,title,phase,seqNum FROM todo WHERE title=?` hits. Evidence `01-board-before.png` / `02-new-task-card.png` + `result.json` (including the apiTodo/dbTodo fields).
- **Persistence (reload).** Manually after the new-task probe: reload `/app`, the same `.todo-card[data-todo-id]` is still in the `待开始` column (the card renders from query truth, the reload is a second confirmation).
- **Project chip.** The dialog's `.new-task-project` shows the current project (after the first creation on a fresh DB = `默认项目`); with multiple projects, open `.new-task-project-menu` and pick a row (`aria-selected`) — the selection is pure form state, submitted with the form (the fixture-surface e2e newtask-project-select.spec.ts already pins this behavior, a live re-check is not mandatory).
- **Single-field shape + placeholder title (fixture surface).** `apps/web/e2e/newtask-single-field.spec.ts` pins: no title input / no tag UI, save gate = non-empty body, first line lands on the card, > 50 characters truncated with ellipsis, autofocus on the body.

## Gotchas

- `保存并开始` POSTs builds (starts a run) — not part of this feature's minimal proof, do not click it casually.
- On a fresh DB the first card triggers the auto project creation first (a two-hop mutation), the card appears one beat slower than a single hop; the probe's 15s wait covers it, do not assert too early in a manual run.
- Assert with `[data-column-list="todo"]` to pin the column + the card's `data-todo-id`, do not guess by column order / coordinates.
- The API/DB assertions must align with the same title on the board — **the title is derived from the body's first line** (placeholder title), the probe's body first line carries a timestamp to avoid colliding with leftover data (a fresh DB theoretically has no leftovers, what it guards against is a reused old stack).
- An agent backfill (`set_task_meta`) changes the title to the LLM's summary once the task starts — verifying "the title changes after start" belongs to the live chain with a daemon; this feature only pins the placeholder state.

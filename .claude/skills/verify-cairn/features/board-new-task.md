# New task (board)

Users turn a thing into a persisted task from the home surface: open the `任务` panel (the `tasks-toggle` button in the home header, or the desktop menu's new-task item which lands on `/app?pane=tasks` with the field already open), press the `+` (`tasks-new`), write only the spec into the add field (`tasks-add-input`, single field — spec 15 #394), submit (`tasks-add-submit` or Enter), and the row lands in the `接下来` (`up_next`) section; the title = the first non-empty line of the body, truncated (a placeholder title, backfilled with the official title by the executing agent via `set_task_meta` after taking the task, ADR 0002). The panel save posts `POST /api/projects/:id/todos` directly when exactly one active project exists; with zero or several projects the same text goes to the Coordinator as a message instead (no `todo` row from that path — it needs an agent turn).

## Sub-features

- `board-render` the workbench shell renders the home surface (`data-testid="home-c"`) with the pane buttons in the header (`tasks-toggle`, `成果`, machines).
- `newtask-open` the `任务` panel header `+` (`data-testid="tasks-new"`) opens the add field (`data-testid="tasks-add-field"` wrapping `tasks-add-input` + `tasks-add-submit`); the desktop menu's new-task item navigates to `/app?pane=tasks` with `{ newTask }` state and the panel opens with the field already open.
- `newtask-gate` the submit button is disabled while the trimmed input is empty (blank and spaces-only do not post).
- `newtask-save` a submit saves the task and switches the panel to the `接下来` tab (`data-section="up_next"` rows); the add field stays open for the next entry. Saving goes through `POST /api/projects/:id/todos` when `saveProjectId` resolves (exactly one active project on the Coordinator home); otherwise the text is sent to the Coordinator.
- `newtask-placeholder-title` the placeholder title = the first non-empty line of the body, <= 50 characters + ellipsis on overflow (server-derived, shared `derivePlaceholderTitle` single source; the fixture surface follows the same rule).
- `newtask-persist` the row's triple truth: visible in `up_next` + a `GET /api/todos` row + a SQLite `todo` table row.

## How to get to it (user POV)

- The `任务` pane button in the home header (`tasks-toggle`), then `+`; or the desktop menu's new-task item (`useDesktopMenu('new-task')` -> `/app?pane=tasks` with the field open). The Coordinator composer (`chief-composer-input` inside `home-c`) is the other text entry, but it delegates task creation to a Coordinator turn and needs an agent.
- Driving (`vp.mjs list board-new-task` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive board-new-task new-task`: seeds one project, opens the `任务` panel, saves through the add field: row in `up_next` + API + SQLite.
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive board-new-task board` (the board-title element it waits for was deleted with #1375); `vp.mjs drive board-new-task overlay-css-migration` (the selectors it reads are no longer in apps/web/src).

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` stack up (fresh DB), `doctor.mjs` fully PASS.

- **Home surface.** Seed one project (`POST /api/projects` with a `hosted` repoKind so the direct save path has a `saveProjectId`), open `/app`, `home-c` renders with the `tasks-toggle` in the header. Evidence `01-board-before.png`.
- **New task.** `tasks-toggle` -> the `任务` panel (`aside[aria-label="任务"]`) -> `tasks-new` -> fill `tasks-add-input` -> `tasks-add-submit`. Run `node <skill>/scripts/drive.mjs new-task`. It walks the full chain: panel opens -> add field opens -> the row lands in `[data-section="up_next"]` with title = first line -> `GET /api/todos` finds that title with `phase=todo` -> SQLite `SELECT id,title,phase,seqNum FROM todo WHERE title=?` hits. Evidence `01-board-before.png` / `02-new-task-row.png` + `result.json` (including the apiTodo/dbTodo fields).
- **Persistence (reload).** Manually after the new-task probe: reload `/app`, the same row title is still in the `接下来` tab (the panel renders from query truth, the reload is a second confirmation).
- **Single-field shape (fixture surface).** `apps/web/e2e/chief-home-add-task.spec.ts` pins the panel add field (opens focused, rejects blank submits, saves into `up_next`, keeps the field on failure); `apps/web/e2e/home-composer-new-task.spec.ts` pins the current new-task entry shape: the home composer is one text box, no project chip, no save-as-draft button. The dialog-era spec (`newtask-single-field.spec.ts`: no title input / no tag UI, first line lands on the card, > 50 characters truncated with ellipsis, autofocus on the body) went with the new-task dialog in #2565.

## Gotchas

- The direct save only exists when exactly one active project is in scope (`saveProjectId`); seed a single hosted project before driving, and wait for the `GET /api/projects` response before clicking so `projectsQuery` has resolved.
- Assert with `[data-section="up_next"] [data-slot="task-row-title"]` inside the `任务` panel, do not guess by tab order / coordinates.
- The API/DB assertions must align with the same title on the panel — **the title is derived from the body's first line** (placeholder title), the probe's body first line carries a timestamp to avoid colliding with leftover data (a fresh DB theoretically has no leftovers, what it guards against is a reused old stack).
- An agent backfill (`set_task_meta`) changes the title to the LLM's summary once the task starts — verifying "the title changes after start" belongs to the live chain with a daemon; this feature only pins the placeholder state.

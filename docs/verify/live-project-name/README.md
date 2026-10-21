# Live surfaces: the todo's own project, never the fixture one

Bug: on the live stack, four places fell back to the fixture capture project `r3-lifecycle` (`PROJECT_NAME`, `apps/web/src/fixtures/core.ts`) when the live project list had no entry for a todo.

- Board card (`board/todo-card.tsx`) and drag overlay (`board/drag-card.tsx`): `r3-lifecycle` while `GET /api/projects` was in flight or failed.
- Detail chip popover (`overlays/chip-popover.tsx`): `r3-lifecycle` on every live todo, projects loaded or not.
- New-task dialog (`overlay/new-task-dialog.tsx`): an `r3-lifecycle` chip and listbox row while projects were pending or failed. Saving posted to `/api/projects/ZAQczKCu0MOAzC1ZqcFlX/todos`, which answers 404.

Not reachable in live: the sidebar's `CANON_PROJECT` row (`board/sidebar.tsx`). `AppSidebar` passes `projectsQ.data ?? []` in live, so `projects` is never undefined there.

## e2e

`apps/web/e2e/live-project-name.spec.ts` boots the live face on stubs and holds, fails or empties `GET /api/projects`. Eight tests: board card pending and failed, drag overlay, chip popover loaded and pending, new-task pending (with a save), failed, and loaded-empty (the save still creates the default project).

- `e2e-old-code.txt`: the spec against a fixture build of `origin/main` (`f436dd29`). 8 failed, each on `r3-lifecycle` or the fixture chip.
- `e2e-new-code.txt`: the same spec against this branch's build. 8 passed.
- `e2e-affected.txt`: `pnpm --filter @pacman/web e2e:affected`, 51 specs, 381 passed. It ran before the loaded-empty test was added, so it counts 7 of the 8.
- `e2e-live-neighbors.txt`: live specs outside the affected set that render these components (`review-reject`, `empty-review-closeout`, `composer-paste`, `project-commit-detail`, `attachment-strip`), 35 passed.

## New-task save while projects are pending

`newtask-save-probe.mjs` holds `GET /api/projects`, opens the dialog, saves, and records every write plus the toast (`newtask-save.txt`).

- `origin/main`: chip `R r3-lifecycle`, writes `POST /api/projects/ZAQczKCu0MOAzC1ZqcFlX/todos`, toast `新建任务失败，请重试。` with the server's `not found`.
- This branch: no chip, no write, toast `新建任务失败，请重试。`. The default project is created only when the projects read has answered with an empty list.

```sh
node docs/verify/live-project-name/newtask-save-probe.mjs http://127.0.0.1:<preview port> $PWD/apps/web
```

## Screenshots

`before/` is `origin/main`, `after/` is this branch. Same spec, same stubs, captured with `PACMAN_E2E_EVIDENCE`.

- `board-pending.png`, `board-loaded.png`: the 待开始 column with `/api/projects` held, then released.
- `drag-pending.png`: the lifted card while held.
- `chip-popover-loaded.png`, `chip-popover-pending.png`: the 任务分配 popover on `/app/todo/todo-1`.
- `newtask-pending.png`, `newtask-loaded.png`: the new-task dialog head while held; the head and project listbox after release.

```sh
cd apps/web
PACMAN_E2E_EVIDENCE=docs/verify/live-project-name/after E2E_PORT=<port> pnpm exec playwright test e2e/live-project-name.spec.ts
```

## Fixture mode, byte for byte

`fixture-dom-dump.mjs` records `innerHTML` on fixture pages: the board scroller and the drag overlay on `/app?scenario=01`, `board-repos` and `newtask-projects`; the chip popover on `/app/todo/r3-legacy-1?scenario=01` and on scenarios `19` and `29`; the new-task head and project listbox on the three boards and on the project page `r2-24c`. 17 dumps. Run on a `vite build --mode fixture` of `origin/main` (`f436dd29`) and of this branch: both files hash to `b68f0fe0274a37c90c03885bfe9ca18b9f5520a0` (`fixture-dom-diff.txt`). `fixture-dom.json` is the dump.

```sh
node docs/verify/live-project-name/fixture-dom-dump.mjs http://127.0.0.1:<preview port> /tmp/out.json $PWD/apps/web
```

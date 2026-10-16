# Paper task card + column headers (PR 3) evidence

Light theme throughout. Plan: `apps/web/docs/paper-redesign-plan.md` PR 3.

## Fixture build (`vite --mode fixture`, 1440x900 @2x unless noted)

| file | what |
|---|---|
| `fixture/before-matrix.png` / `after-matrix.png` | `board-drag-matrix`: queued, running, failed, waiting-on-reply, confirm, done |
| `fixture/before-matrix-hover.png` / `after-matrix-hover.png` | same, pointer on the queued card (hover 开始 link, card tint, column plus) |
| `fixture/before-tags.png` / `after-tags.png` | `board-tags`: tag on the icon, tag truncating first, 待审阅 footer |
| `fixture/before-stress-1152.png` / `after-stress-1152.png` | `board-stress` at the 1152px / 200px-column floor: long title, project name at its 5-character floor |

Before = base commit `9ced1c1a`, after = this branch. Rerun: start `pnpm exec vite --mode fixture --port <p>` in `apps/web`, then
`node fixture-shot.mjs http://127.0.0.1:<p> <out.png> <scenario> light <w> <h> [hoverTodoId]` (copy the script into `apps/web` so `@playwright/test` resolves).

## Live stack (verify-pacman, server 8791 / web 5273, fresh library)

`node docs/verify/paper-card/live-probe.mjs <outDir>` after `launch.mjs`: 12/12 checks (`live/result.json`).

- Real clicks: 待开始 column plus → 新建任务 dialog → save; hover 开始 link → `POST /api/todos/:id/orchestrate`. The isolated stack has no chief agent or machine, so that call answers 409; the probe pins that the link reaches the board's start handler.
- Seeded over REST: long project name, a tagged card, running / done / canceled / confirm via the board's manual phase PATCH (`live/phase-patch-status.json`). Failed and review need a real build (manual PATCH answers 409), so those two faces are covered by the fixture shots.
- `live/01-board.png`, `live/02-board-hover.png`, `live/03-after-start-click.png`; API rows `live/api-todos.json`; SQLite rows `live/sqlite-todo-rows.json`.

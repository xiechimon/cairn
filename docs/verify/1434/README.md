# #1434 evidence: a queued card does not drop into `执行中`

Base = `498517d` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

`canDropOnColumn(todo, 'building')` in `apps/web/src/board/columns.ts` is true only for a `todo` card. A queued card (started, waiting for a machine) shares the `待开始` column, but `执行中` does not light up for it and a drop there does nothing. A drop into `执行中` is a start intent (`POST /api/todos/:id/orchestrate`), and `apps/server/src/services/orchestrate.ts` starts only `todo` / `failed` tasks.

## Unit: `apps/web/test/columns.test.ts`

- `unit-old-leg.txt`: base. 2 failed / 25 passed. The queued source row and the per-phase `执行中` loop both fail on `queued` (`expected true to be false`).
- `unit-new-leg.txt`: branch. 27 passed. The loop checks all nine phases: only `todo` may enter `执行中`.

## e2e: `apps/web/e2e/board-queued-drop.spec.ts`

Stubbed live board (no `?scenario=`), one queued card and one todo card in `待开始`. Every `POST /api/todos/:id/orchestrate` is recorded; the queued one is answered 409, as the server does.

The queued test first waits until `已完成` shows `data-drop-valid="true"` (a valid target for a queued card), so its negative checks on `执行中` read a settled drag. After the queued drop it drops the todo card as a sentinel: the recorded POSTs must be exactly `[todo card]`, and no toast may name `当前 queued`.

- `e2e-old-leg.txt`: the final spec run on base `498517d` in a scratch worktree. The queued test passes the `已完成` settle check, then fails at the `执行中` drop-target check (`Received: "true"`). The todo test passes.
- `e2e-new-leg.txt`: branch. 2 passed.
- `e2e-affected.txt`: `pnpm --filter @pacman/web e2e:affected -- <board.tsx> <columns.ts> <the spec> <shared phase.ts>`: the board family, 22 specs, 183 passed. The paths are passed explicitly because the selector maps `apps/web/test/` (vitest files) to the full suite; that file has no e2e surface and runs under vitest. The shared `phase.ts` change is a comment.

Screenshots (written by the spec with `PACMAN_E2E_EVIDENCE`):

| shot | `old/` (base) | `new/` (branch) |
|---|---|---|
| `queued-over-building.png` | `执行中` tinted while the queued card hovers it | `执行中` untinted |
| `todo-over-building.png` | `执行中` tinted for the todo card | unchanged |

## Drop trace: `old/drop-trace.json`, `new/drop-trace.json`

A one-off probe (not committed), same stubs: hover the queued card over `执行中`, read the column attributes, release, wait 1.5 s, read the toasts. `after-drop.png` is the page after the wait.

- base: column `data-drop-valid` / `data-drop` = `"true"`; one orchestrate POST for the queued card; toast `未能开始编排 / orchestrate 仅适用于 待开始/失败 相位（当前 queued）`.
- branch: both attributes absent; no POST; no toast.

## Rerun

```sh
cd apps/web
pnpm exec vitest run test/columns.test.ts
PACMAN_E2E_EVIDENCE=docs/verify/1434/new E2E_PORT=8398 pnpm exec playwright test board-queued-drop.spec.ts
```

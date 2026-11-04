# #1457 evidence: one shared rule for which phases can start

Base = `0d75239b` (this branch after #1455; the files touched here are unchanged since origin/main `23a39da9`). Branch = `claude/optimistic-albattani-r5pmfn`.

`packages/shared/src/phase.ts` exports `ORCHESTRATE_PHASES = ['todo', 'failed']` and `canOrchestrate(phase: Phase)`. Every place that hand-wrote the set reads it now:

- `apps/server/src/services/orchestrate.ts` `orchestrateTodo`: its 409 check.
- `packages/shared/src/phase.ts` `canBoardDrop`: the building case (raw PATCH into `执行中`) requires it on top of the `待开始` column rule.
- `apps/web/src/board/columns.ts` `canDropOnColumn`: the `执行中` case requires it on top of the column rule. A drop there opens the start gate, which calls `POST /api/todos/:id/orchestrate`.
- `apps/web/src/board/todo-card.tsx` `lockedByOrchestration` and `apps/web/src/routes/todo-detail-page.tsx` `actionInFlight` (#1216): the phases where an orchestrate round can be in flight.

Today `待开始` holds only todo, so the two board guards change nothing. They are the backstop for the #1434 shape: a phase that orchestrate refuses living in `待开始` again. No drop that works today changes.

## Unit

- `unit-old-leg.txt`: the two new relation tests before the shared export exists. web `columns.test.ts`: `TypeError: canOrchestrate is not a function`. shared `vocabulary.test.ts`: `expected undefined to deeply equal [ 'todo', 'failed' ]`.
- `unit-new-leg.txt`: the first commit. web `columns.test.ts` 30 passed, shared `vocabulary.test.ts` 39 passed, server `orchestration-source.test.ts` + `persona-split-verify.test.ts` (the orchestrate 409 tests) 27 passed. After the code-review follow-up (`canBoardDrop`, the card lock and the detail in-flight bit): the same web and shared files pass, and server `phase.test.ts` + `manual-drop-matrix.test.ts` + `orchestration-source.test.ts` pass 33.
- `widened-red.txt`: each relation test catches its rule widening on its own. The rule was edited locally, the test run, and the edit restored (captured on the first commit, before `canBoardDrop` read `canOrchestrate`):
  - `canDropOnColumn` building case widened to `src.id !== 'building'` with the guard removed: `AssertionError: confirm: expected false to be true`.
  - `canBoardDrop` building case widened to `src !== '执行中'`: multiplied same failure.
- `server-suite.txt`: the whole server suite, 110 files, 1158 passed, 1 skipped.

## e2e

`e2e-affected.txt`: `e2e-affected.mjs -- apps/web/src/board/columns.ts apps/web/src/board/todo-card.tsx apps/web/src/routes/todo-detail-page.tsx` (board and detail families + a11y-axe), 47 specs, 371 passed. These include `board-dnd`, `board-queued-drop`, `board-queued-column` and the detail specs, unchanged.

## Rerun

```sh
(cd apps/web && pnpm exec vitest run test/columns.test.ts)
(cd packages/shared && pnpm exec vitest run test/vocabulary.test.ts)
```

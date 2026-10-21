# #1457 evidence: one shared rule for which phases can start

Base = `0d75239b` (this branch after #1455; the files touched here are unchanged since origin/main `23a39da9`). Branch = `claude/optimistic-albattani-r5pmfn`.

`packages/shared/src/phase.ts` exports `ORCHESTRATE_PHASES = ['todo', 'failed']` and `canOrchestrate(phase)`. Two consumers read it:

- `apps/server/src/services/orchestrate.ts` `orchestrateTodo` uses it for its 409 check.
- `apps/web/src/board/columns.ts` `canDropOnColumn` requires it in the 执行中 case, on top of the column rule. A drop there opens the start gate, which calls `POST /api/todos/:id/orchestrate`, so the board can no longer offer a drop the server would refuse, whatever column a phase lives in.

`canBoardDrop` (the raw PATCH matrix) keeps its column rule; a shared test bounds it by the same set. No drop that works today changes.

## Unit

- `unit-old-leg.txt`: the two new relation tests before the shared export exists. web `columns.test.ts`: `TypeError: canOrchestrate is not a function`. shared `vocabulary.test.ts`: `expected undefined to deeply equal [ 'todo', 'failed' ]`.
- `unit-new-leg.txt`: branch. web `columns.test.ts` 30 passed, shared `vocabulary.test.ts` 39 passed, server `orchestration-source.test.ts` + `persona-split-verify.test.ts` (the orchestrate 409 tests) 27 passed.
- `widened-red.txt`: each relation test catches its rule widening on its own. The rule was edited locally, the test run, and the edit restored:
  - `canDropOnColumn` building case widened to `src.id !== 'building'` with the guard removed: `AssertionError: confirm: expected false to be true`.
  - `canBoardDrop` building case widened to `src !== '执行中'`: same failure.
- `server-suite.txt`: the whole server suite, 110 files, 1158 passed, 1 skipped.

## e2e

`e2e-affected.txt`: `e2e-affected.mjs -- apps/web/src/board/columns.ts` (board family + a11y-axe), 25 specs, 239 passed. These include `board-dnd`, `board-queued-drop` and `board-queued-column`, unchanged.

## Rerun

```sh
(cd apps/web && pnpm exec vitest run test/columns.test.ts)
(cd packages/shared && pnpm exec vitest run test/vocabulary.test.ts)
```

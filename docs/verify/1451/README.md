# #1451 evidence: marking an in-progress task done stops its active step

Base = `4f71b7a1` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

A move from an in-progress phase (queued / planning / building) to done now stops the task's active step through `stopActiveStepsAfterExit` (`apps/server/src/services/builds.ts`), as closing and the move back to todo already do. Two entry points call it:

- `PATCH /api/todos/:id` (`apps/server/src/routes-todos.ts`): a move from `IN_PROGRESS_PHASES` to done (or todo, from #1447), judged on the written record. Funnel edges such as building → review do not trigger it.
- `transitionTodos` (`apps/server/src/services/chief-tools.ts`), used by chief and MCP `complete_todos`: a done from an in-progress phase. The system funnel allows only building → done here.

A pending / waiting_quota step stops at once. A claimed step gets the delegated stop with the `keep` reservation, so the stop report leaves the card done. Two code-review follow-ups:

- If a restart drops the `keep` reservation, `applyStoppedStep` still leaves a card that was closed, marked done or moved back to todo where it is. Before, only closed was guarded, and a done card fell back to its gate (confirm / review).
- `sweepAbandonedBuildSteps` treats done like closed: it stops leftover pending / waiting_quota steps of done tasks, and stops instead of releasing an abandoned claimed step of a done task. A stop sent to an offline machine therefore cannot turn into a release back to pending. The web does not send either write for an in-progress card (the board's in-flight done gate uses `POST /api/todos/:id/stop-and-done`, and the detail page's 完成 is disabled), so no web file changes.

## Server tests

`apps/server/test/close-stops-active-steps.test.ts` gains a `#1451` block. `apps/server/test/persona-split-verify.test.ts` "manual done stops the pending step (#1247, #1451)" asserts the pending build step is stopped; it used to pin the opposite.

- `server-test-old-leg.txt`: base. 4 failed, 27 passed.
  - PATCH queued → done: `expected { step: { …(5) }, …(7) } to be null`. The home machine claims the done task's step.
  - PATCH planning → done and `complete_todos` on a building card: `expected [] to deeply equal [ 'step-…' ]`. No stop is sent.
  - The #1247 test: `expected [ 'pending' ] to deeply equal [ 'stopped' ]`.
  - The control (review → done with no active step, by PATCH and by `complete_todos` with a user actor) passes on base and on the branch: no stop is sent.
- `server-test-review-old-leg.txt`: the code-review follow-up tests before their fix. 4 failed: a lost reservation with the card done or todo (`expected 'confirm' to be 'done'` / `'todo'`), and the sweep on a done task's leftover pending step and abandoned claimed step (`expected 'pending' to be 'stopped'`).
- `server-test-new-leg.txt`: branch. 35 passed.
- `server-suite.txt`: the whole server suite on the branch, 110 files, 1148 passed, 1 skipped.

## Rerun

```sh
cd apps/server
pnpm exec vitest run test/close-stops-active-steps.test.ts test/persona-split-verify.test.ts
```

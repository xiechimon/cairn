# #1451 evidence: marking an in-progress task done stops its active step

Base = `4f71b7a1` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

A move from an in-progress phase (queued / planning / building) to done now stops the task's active step through `stopActiveStepsAfterExit` (`apps/server/src/services/builds.ts`), as closing and the move back to todo already do. Two entry points call it:

- `PATCH /api/todos/:id` (`apps/server/src/routes-todos.ts`): any move out of `IN_PROGRESS_PHASES`, judged on the written record.
- `transitionTodos` (`apps/server/src/services/chief-tools.ts`), used by chief and MCP `complete_todos`: a done from an in-progress phase. The system funnel allows only building → done here.

A pending / waiting_quota step stops at once. A claimed step gets the delegated stop with the `keep` reservation, so the stop report leaves the card done. The web does not send either write for an in-progress card (the board's in-flight done gate uses `POST /api/todos/:id/stop-and-done`, and the detail page's 完成 is disabled), so no web file changes.

## Server tests

`apps/server/test/close-stops-active-steps.test.ts` gains a `#1451` block. `apps/server/test/persona-split-verify.test.ts` "manual done stops the pending step (#1247, #1451)" asserts the pending build step is stopped; it used to pin the opposite.

- `server-test-old-leg.txt`: base. 4 failed, 27 passed.
  - PATCH queued → done: `expected { step: { …(5) }, …(7) } to be null`. The home machine claims the done task's step.
  - PATCH planning → done and `complete_todos` on a building card: `expected [] to deeply equal [ 'step-…' ]`. No stop is sent.
  - The #1247 test: `expected [ 'pending' ] to deeply equal [ 'stopped' ]`.
  - The control (review → done with no active step, by PATCH and by `complete_todos` with a user actor) passes on base and on the branch: no stop is sent.
- `server-test-new-leg.txt`: branch. 31 passed.
- `server-suite.txt`: the whole server suite on the branch, 110 files, 1144 passed, 1 skipped.

## Rerun

```sh
cd apps/server
pnpm exec vitest run test/close-stops-active-steps.test.ts test/persona-split-verify.test.ts
```

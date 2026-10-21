# #1445 evidence: closing a task stops its active step

Base = `bbd1e858` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

Closing a task now stops its latest build's active step (`apps/server/src/services/builds.ts` `stopActiveStepsAfterExit`). The two close entry points call it after the phase write: `transitionTodos` (chief and MCP `close_todos`) and the `PATCH /api/todos/:id` route. A pending / waiting_quota step is stopped at once. A claimed step gets the delegated stop plus an in-memory `keep` reservation, so `applyStoppedStep` records the stopped step and leaves the phase to whoever moved the card. If the reservation is lost to a process restart, `applyStoppedStep` still leaves a closed card closed. `sweepAbandonedBuildSteps` stops leftover pending / waiting_quota steps of closed tasks and stops, instead of releasing, an abandoned claimed step of a closed task.

Code-review follow-ups use the same function:

- Closing replaces a pending stop-and-done reservation (#1247) for the build. Without that, the stop report would rewrite the closed card to done.
- A card reopened before the stop report arrives keeps its reopened phase (the `keep` reservation). Before, the gate fallback overwrote it.
- A raw `PATCH` from queued / planning / building to todo stops the active step too. #1447 moved queued into 执行中, so `canBoardDrop` now lets a raw PATCH move it to 待开始, as it already did for planning / building (the web uses `/reset` for that drop). queued → done is left as it was: #1247 pins that a raw PATCH done keeps the pending step (`persona-split-verify.test.ts`, "manual done leaves the pending step running"), and stop-and-done is the entry point that stops.

## Server test: `apps/server/test/close-stops-active-steps.test.ts`

Each world has one task, its build, one plan step, and an online pi machine that is the agent's home machine, so a pending step is claimable (the control in the sweep test claims one).

- `server-test-old-leg.txt`: base. 5 failed.
  - close_todos and PATCH on a queued task: `expected { step: { …(5) }, …(7) } to be null`. The home machine claims the closed task's step.
  - Closing a planning task with a claimed step: `expected [] to deeply equal [ 'step-…' ]`. No stop is sent.
  - Sweep on a closed task's leftover pending step, and on its abandoned claimed step: `expected 'pending' to be 'stopped'`. The step stays claimable or is released back to pending.
- `server-test-followup-old-leg.txt`: the follow-up tests before their fix. 3 failed: the close after stop-and-done (`expected 'done' to be 'closed'`), and PATCH queued → todo / → done (`expected { step: … } to be null`). The → done case was then dropped, because #1247 pins the opposite (see above).
- `server-test-review2-old-leg.txt`: the second review round's tests before their fix. 2 failed: closing then reopening to review before the report (`expected 'todo' to be 'review'`), and PATCH planning → todo (`expected [] to deeply equal [ 'step-…' ]`, no stop sent).
- `server-test-new-leg.txt`: branch. 10 passed: the 5 above, the stop-and-done close, PATCH queued → todo, a control where a PATCH that keeps the phase (a title edit, or `phase: 'queued'`) leaves the pending step claimable, the reopen-before-report case, and PATCH planning → todo.
- `server-suite.txt`: the whole server suite on the branch, 110 files, 1140 passed, 1 skipped.

## Rerun

```sh
cd apps/server
pnpm exec vitest run test/close-stops-active-steps.test.ts
```

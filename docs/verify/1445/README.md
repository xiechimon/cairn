# #1445 evidence: closing a task stops its active step

Base = `bbd1e858` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

Closing a task now stops its latest build's active step (`apps/server/src/services/builds.ts` `stopActiveStepsForClose`). The two close entry points call it after the phase write: `transitionTodos` (chief and MCP `close_todos`) and the `PATCH /api/todos/:id` route. A pending / waiting_quota step is stopped at once; a claimed step gets the delegated stop, and `applyStoppedStep` leaves a closed card closed when the stop report arrives. `sweepAbandonedBuildSteps` stops leftover pending / waiting_quota steps of closed tasks and stops, instead of releasing, an abandoned claimed step of a closed task.

## Server test: `apps/server/test/close-stops-active-steps.test.ts`

Each world has one task, its build, one plan step, and an online pi machine that is the agent's home machine, so a pending step is claimable (the control in the sweep test claims one).

- `server-test-old-leg.txt`: base. 5 failed.
  - close_todos and PATCH on a queued task: `expected { step: { …(5) }, …(7) } to be null`. The home machine claims the closed task's step.
  - Closing a planning task with a claimed step: `expected [] to deeply equal [ 'step-…' ]`. No stop is sent.
  - Sweep on a closed task's leftover pending step, and on its abandoned claimed step: `expected 'pending' to be 'stopped'`. The step stays claimable or is released back to pending.
- `server-test-new-leg.txt`: branch. 5 passed.
- `server-suite.txt`: the whole server suite on the branch, 110 files, 1135 passed, 1 skipped.

## Rerun

```sh
cd apps/server
pnpm exec vitest run test/close-stops-active-steps.test.ts
```

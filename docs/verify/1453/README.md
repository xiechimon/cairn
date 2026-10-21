# #1453 evidence: a step that finishes before its stop lands leaves an exited card alone

Base = `66d5022e` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

When a card leaves 执行中 (closed, marked done, or moved back to todo), #1445 / #1451 send a claimed step a delegated stop. If the daemon finishes the step normally before it sees the stop, it reports `done(success)`. `completeStep` (`apps/server/src/services/builds.ts`) now checks three things before the artifact gate, for every step kind:

- the card has left 执行中 (closed, done or todo);
- the step belongs to an older build than the card's `latestBuildId` (the card was reopened and rerun);
- a stop reservation exists for the build.

In any of these cases it marks the step done and returns. It skips the artifact gate, the phase write, the plan-rewrite enqueue and the review / verify verdict, and drops the reservation. A `done` reservation from stop-and-done (#1247) still lands the card on done. The report answers 200, so the daemon clears its journal instead of replaying the report on every restart.

The failure report needed no change: `applyStepFailure` already writes the phase only when `canTransitionPhase(phase, 'failed')`. A split parent's plan doc is written directly by `createSplitTodo` without a plan step, so no plan step completes on a todo card in normal flow.

## Server tests

`apps/server/test/close-stops-active-steps.test.ts` gains a `#1453` block. Each test moves the card with `PATCH /api/todos/:id` (which sends the stop) and then reports success through `finishStep` (`apps/server/src/services/machines.ts`), the function `POST /api/machine/done/:stepId` calls.

- `server-test-old-leg.txt`: base. 4 failed, 19 passed.
  - Closed card, plan step with a plan doc: `PhaseTransitionError: illegal phase transition: closed -> confirm`. The route turns this into 409.
  - Done card, build step: `illegal phase transition: done -> review`.
  - Card moved back to todo, plan step with a plan doc: `expected 'confirm' to be 'todo'`. The card jumped to 确认.
  - Closed card, plan step without a plan doc: `expected [ 'done', 'pending' ] to deeply equal [ 'done' ]`. A rewrite plan step was enqueued for a closed card.
  - The control (a planning card's plan step moves the card to confirm) passes on base and on the branch.
- `server-test-review-old-leg.txt`: the code-review follow-up tests, run on the first fix commit. 5 failed:
  - Closed card, merge step: `illegal phase transition: closed -> done`.
  - Closed card, review step with a blocking finding: `illegal phase transition: closed -> planning`.
  - Done card, build step with no changes: `expected 'failed' to be 'done'`. The artifact gate marked the step failed and rewrote `build.errorMessage`.
  - Card closed, then reopened and rerun on a new build: the old build's plan step moved it to confirm (`expected 'confirm' to be 'planning'`).
  - Stop-and-done in flight and the build step finishes first: `expected 'review' to be 'done'`.
- `server-test-new-leg.txt`: branch. 28 passed.
- `server-suite.txt`: the whole server suite on the branch, 110 files, 1158 passed, 1 skipped.

## Rerun

```sh
cd apps/server
pnpm exec vitest run test/close-stops-active-steps.test.ts
```

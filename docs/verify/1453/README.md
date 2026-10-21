# #1453 evidence: a step that finishes before its stop lands leaves an exited card alone

Base = `66d5022e` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

When a card leaves 执行中 (closed, marked done, or moved back to todo), #1445 / #1451 send a claimed step a delegated stop. If the daemon finishes the step normally before it sees the stop, it reports `done(success)`. `completeStep` (`apps/server/src/services/builds.ts`) now marks a plan or build step done and returns when the card is closed, done or todo. It skips the phase write and the plan-rewrite enqueue, and drops the build's `keep` reservation. The report then answers 200, so the daemon clears its journal instead of replaying the report on every restart.

The failure report needed no change: `applyStepFailure` already writes the phase only when `canTransitionPhase(phase, 'failed')`. A split parent's plan doc is written directly by `createSplitTodo` without a plan step, so no plan step completes on a todo card in normal flow.

## Server tests

`apps/server/test/close-stops-active-steps.test.ts` gains a `#1453` block. Each test moves the card with `PATCH /api/todos/:id` (which sends the stop) and then reports success through `finishStep` (`apps/server/src/services/machines.ts`), the function `POST /api/machine/done/:stepId` calls.

- `server-test-old-leg.txt`: base. 4 failed, 19 passed.
  - Closed card, plan step with a plan doc: `PhaseTransitionError: illegal phase transition: closed -> confirm`. The route turns this into 409.
  - Done card, build step: `illegal phase transition: done -> review`.
  - Card moved back to todo, plan step with a plan doc: `expected 'confirm' to be 'todo'`. The card jumped to 确认.
  - Closed card, plan step without a plan doc: `expected [ 'done', 'pending' ] to deeply equal [ 'done' ]`. A rewrite plan step was enqueued for a closed card.
  - The control (a planning card's plan step moves the card to confirm) passes on base and on the branch.
- `server-test-new-leg.txt`: branch. 23 passed.
- `server-suite.txt`: the whole server suite on the branch, 110 files, 1153 passed, 1 skipped.

## Rerun

```sh
cd apps/server
pnpm exec vitest run test/close-stops-active-steps.test.ts
```

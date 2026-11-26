# Task state machine

Status: approved by the owner on 2026-11-19 (rebuild, not patch; `failed` stays terminal; reopening an ended task starts a new run and a new session; stop ends the task). Research and data: the state machine review artifact of that day, built on the 2026-11-18 server database backup, the `verify-step-claim` TLA+ suite and a comparison with Temporal, GitHub Actions, Codex, Claude Code, Letta, OpenHands and Devin.

## Who meets it

Every task card. Today a task you stop before it delivers anything goes back to "not started" and looks like a task nobody ever ran; a task restarted from a running state and then stopped can land in "running" with nothing running, and stays there until someone archives it (#155, #167, #169 in the backup). After this change a stop that ends a run before it delivered anything shows the task as **Stopped**. A message from the task's own composer, send now on a waiting message included, continues the stopped conversation; pressing Rerun, or a message through the task reply route (the Coordinator's), starts a new run.

## Target

Four outer states with the reason or result in a field, the shape Letta and GitHub Actions use:

| State | Phases today | Field |
|---|---|---|
| queued | `queued` | `waitingOn`: machine, capacity, strained, quota |
| running | `planning`, `building` | the step kind |
| waiting | `confirm`, `needs_input`, `review` | who it waits for |
| ended | `done`, `failed`, `stopped`, `closed` | the conclusion is the phase |

`todo` is the task before its first run. The phase values stay; the outer state is derived from them, so the database and wire keep one column.

## Rules

1. Every phase write goes through `setTodoPhase`, which checks `PHASE_TRANSITIONS` (`apps/server/src/services/phase.ts`). A stop passes `cause: 'stop'` and may additionally return the task to the last thing it delivered (`confirm` after a plan, `review` after a build, or the phase the run started from when that phase was `confirm`, `review`, `done` or `failed`), or end it as `stopped`. A stop never writes `todo` or an in-flight phase.
2. A stop is settled only when the runner reports the step stopped. The runner reports it only after the agent process has exited, background subagents are dropped and background commands are killed and reaped (daemon side, `apps/daemon/src/backend/claude-code.ts`).
3. Ended tasks hold no session and no background work. `stopped` leaves to `queued`, `done` or `closed`. A new run records `prevPhase = 'stopped'` and does not reuse the old session. A composer message, or the MCP `reply_thread` tool in queue mode, continues the stopped run in its conversation (`sendBuildSteer` with `afterTurn`), and so does a person answering a question left on it; a scheduled wake or a steer that carries an agent actor, such as the Coordinator answering that question, never does.
4. After a turn, a running task with live work (a foreground step, a background subagent, a background command) keeps its session open; a waiting task checkpoints and sends no model requests.
5. Every phase change appends one `todo_transition` row (from, to, cause, at), written in the same transaction as the phase by `setTodoPhase` and `updateTodo`. The cause is `stop`, `manual` (a board move) or empty for the system. `inspect_run` returns the last rows as `phaseHistory`, so the Coordinator and a debugging session can see how a task reached its phase.
6. The scheduler checks every in-flight phase, not only `queued`. A `planning`, `building` or `needs_input` task whose latest run has no active step, no pending question, no queued message and no pending steer, and whose phase and last step are both older than two minutes, is settled as `failed` with the run's reason (`build-stalled-sweep.ts`).

## Paths that write the phase

`setTodoPhase` callers in build start, claim, step completion, step failure, confirm, steer, PR wakes, CI rounds and Coordinator tools; `updateTodo` for manual board moves (checked by `canBoardDrop`); task creation. The three direct writes in `build-stop.ts` (`landReservedPhase`, `applyStoppedStep`, `releaseZombieQueued`) are the ones this change removes.

## Failure behavior

- An illegal edge throws `PhaseTransitionError`; a stop that lands after the task already ended (`todo`, `done`, `stopped`, `closed`) changes nothing.
- A stop on an archived task ends it as `stopped`; unarchiving returns it as `stopped`.
- Existing rows: migration `0224` moves tasks that sit in `todo` with a latest run whose every step was stopped to `stopped`.

## Steps

Each is one change with one test per path.

1. `stopped` phase and the single write path for stops (this page's first change).
2. Transition log table written by `setTodoPhase` and `updateTodo`.
3. Zombie sweep for `planning`, `building` and `needs_input`, with the shapes of #155, #167 and #169 as regression tests.
4. One representation of the quota wait; `waitingOn` read from one source.
5. Retry policy with backoff and a total cap on top of `retry-parking.ts`; `failed` shown as ended with a notification instead of waiting on the owner.
6. Move the TLA+ `sync-commit` forward and add a task-phase model with a liveness check that an in-flight task eventually leaves.

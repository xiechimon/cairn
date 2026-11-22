# Coordinator model switch notice

Problem: when the Coordinator's main model fails with a quota, capacity,
outage, auth or network error and a backup model is configured on the
Coordinator routing rule, the turn is requeued on the backup
(`requeueChiefStepOnFallback`, apps/server/src/services/machine-finish-step.ts)
and continues. The thread showed this only in a banner while that turn ran and
in a hover note on the reply, so after the turn the user could not tell that
replies came from another model, nor that the main model came back.

Decision: keep continuing automatically on the backup. Say it in the thread
with one quiet status line per switch, in the user's language, and say when
the main model is back. A flapping provider does not add a line per turn.

## State

No new table. The thread's own rows are the state, written only by this
mechanism:

| row id                           | content                                                       |
|----------------------------------|---------------------------------------------------------------|
| `chief-fallback-<stepId>-<n>`    | `chief_model_fallback` `{ from, to, stepId, announced }`      |
| `chief-model-restored-<stepId>`  | `chief_model_restored` `{ model, stepId }`                    |

`announced` says whether the fallback row renders as a line. Rows written
before this change have no `announced` field and stay hidden, so history does
not grow lines retroactively.

"What the user was last told" is the newest row that is an announced fallback
(on backup `to`) or a restored row (on the main model); none means main model.
Ties on `createdAt` are broken by `rowid`.

## Transitions

`MODEL_SWITCH_QUIET_MS` is 15 minutes.

- A turn is requeued on backup `to`:
  - told "on `to`": not announced.
  - told "on another backup": announced (the model answering changed).
  - told "main model": announced unless the last announced row is younger
    than the quiet window.
- A turn that ran with no fallback finishes successfully while the told state
  is "on a backup": a restored row is written, naming the main model from the
  Coordinator routing rule.

So a provider that fails every other turn produces at most one switch line
and one restored line per window. A suppressed switch still shows the
per-reply note `由备用模型 X 回答` and the live banner, so no reply is
unattributed.

## Paths

Both Coordinator runtimes reach the same two functions:

- in-server runtime: `server-api.ts` `done` calls `requeueChiefStepOnFallback`,
  then `finishCoordinatorTurn`;
- backend runtime on a Runner: `machine-finish-step.ts` does the same.

`fallbackAnnounced` and `announcePrimaryRestored` live in
`apps/server/src/services/chief-model-switch.ts`. The web mapper turns both
row kinds into the `note` status line.

## Failure behavior

With no backup configured, or none available, `planModelFallback` returns
nothing, no row is written and the turn fails or parks with the real reason
as before. A restored row is not written when the Coordinator rule has no
model.

## Tests

`apps/server/test/chief-queue-steer-stop.test.ts`, "the thread says once when
a turn runs on the backup and when the primary is back": a switch line, a
restored line, then a flapping sequence inside the window adds nothing, and
after the window a new switch is announced. `apps/web/e2e/chief-home-busy.spec.ts`
renders both lines.

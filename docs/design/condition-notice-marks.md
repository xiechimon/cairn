# Condition notice marks (#2488)

Problem: the inbox keeps one `notification` row per user and entity
(`<userId>:<todoId>`). Two sweeps on the scheduler tick raise notices for
ongoing conditions on a task and decided "already notified" by reading that
shared row: `sweepUnplaceableSteps` skipped when the row was `no_machine` and
newer than the wait, `sweepWorkerWatchdog` skipped when the row was
`watchdog_flag` with the same snippet. When both conditions hold on one task,
each sweep overwrites the row the other one reads, so each sees a change on
every tick and re-notifies: two desktop notifications every 15 s, forever.
Any one-shot notice on the same task (quota wait, model fallback, review,
schedule run) also made both sweeps fire again once.

Bug class: dedupe state for a condition stored in a record that other
producers also write.

## Decision

Each ongoing condition keeps its own dedupe mark, written only by the sweep
that owns the condition. The inbox row stays a display record that no sweep
reads back.

Table `notice_mark`:

| column        | meaning                                                      |
|---------------|--------------------------------------------------------------|
| `id`          | `<userId>:<condition>:<subjectId>`, primary key              |
| `userId`      | the notified user                                            |
| `condition`   | `no_machine` or `watchdog_flag`                              |
| `subjectId`   | the step (`no_machine`) or task (`watchdog_flag`) it is about |
| `fingerprint` | the content that counts as a material change                 |
| `notedAt`     | when the notice was raised                                   |

Fingerprints: `no_machine` uses the step's wait start (`waitingSince`), so the
growing minute count in the snippet is not a change and a new wait is.
`watchdog_flag` uses the snippet, which changes only when a reason starts,
ends or its count moves (a new BLOCK round, a new repeated failure).

## Transitions

One function, `raiseConditionNotices(deps, condition, active)`, is the only
reader and writer. Each sweep passes the subjects whose condition holds this
tick, each with its fingerprint and a callback that writes the notice.

- no mark: write the notice and the mark in one transaction.
- mark with the same fingerprint: nothing.
- mark with another fingerprint: write the notice and replace the mark.
- mark whose subject is not active this tick: delete it, so the condition
  notifies again when it next starts.

Reading or marking the notice read never touches marks, so a read notice does
not come back while its condition is unchanged.

## Failure behavior

The notice and the mark commit together; a throw while writing the notice
leaves no mark, and the next tick retries. On upgrade the migration seeds
`watchdog_flag` marks from existing `watchdog_flag` inbox rows; open
`no_machine` waits have no step id on their inbox row and notify once more
after the upgrade.

## Tests

`apps/server/test/unplaceable-steps.test.ts`, "coexisting conditions on one
task each notify once": both sweeps across eight ticks plus a model-fallback
notice in between publish exactly one notice per condition. Existing tests in
that file and `worker-watchdog.test.ts` cover a read notice staying quiet,
a changed reason notifying again and a cleared condition staying silent.

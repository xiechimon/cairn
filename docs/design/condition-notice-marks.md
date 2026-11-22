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

Fingerprints: `no_machine` uses the reason type and the step's wait start
(`<reason>:<waitingSince>`). The reason type is the kind of wait the notice
names, because each asks the user for a different action:
`capability-missing`, `sandbox-unavailable`, `machine-retired`,
`runner-cannot-run` (the pinned Runner cannot take the step) and `no-runner`.
A change of reason type notifies again; the growing minute count and a change
inside one reason (another missing capability) do not. A new wait does.
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
leaves no mark, and the next tick retries.

Upgrade seeds marks so a condition the user was already told about does not
notify again:

- `0247` seeds `watchdog_flag` marks from existing `watchdog_flag` inbox rows.
- `0248` seeds `no_machine` marks for every pending step whose task's inbox
  row is a `no_machine` notice raised during the current wait, reading the
  reason type back from the notice text. It also rewrites marks `0247`-era
  sweeps wrote with the wait start alone into the `<reason>:<waitingSince>`
  form. A wait whose inbox row another notice has since overwritten carries
  no reason to read back and notifies once after the upgrade; under the code
  before `0247` it re-notified on every tick, so this is no regression.
  Desktop builds that already ran `0247` before `0248` shipped got their one
  extra `no_machine` reminder then; `0248` stops the second one that the
  reason-type fingerprint would otherwise cause.

## Tests

`apps/server/test/unplaceable-steps.test.ts`, "coexisting conditions on one
task each notify once": both sweeps across eight ticks plus a model-fallback
notice in between publish exactly one notice per condition. Existing tests in
that file and `worker-watchdog.test.ts` cover a read notice staying quiet,
a changed reason notifying again and a cleared condition staying silent.

"the upgrade marks waits users were already told about" runs `0248` over a
database with no mark and one with a `0247`-format mark, then sweeps: nothing
is published. "a wait whose reason changes notifies again" moves one wait
from a missing capability to an unready sandbox and sweeps twice per reason:
two notices.

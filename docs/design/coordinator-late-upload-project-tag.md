# Tag late chief transcript uploads with the producing turn's project

Issue #2555. Since #2547 one Coordinator thread is shared per team and each
`chief_message.projectId` tags which project scope the row belongs to; a
project-filtered view reads that column.

## Bug

`upsertChiefMessage` fills `projectId` with `writingTurnProjectId` when the
caller passes no `projectId`. For rows that are not the turn prompt echo
(`transcriptPromptRowId`), that lookup is

> the latest `kind='chief'` step with `status='claimed'` on the thread,

i.e. "the turn currently running", not "the turn that produced the row". When a
turn is force-stopped on the server (`sweepOverlongChiefTurns`,
`stopClaimedChiefStep` on a stale heartbeat, `sweepAbandonedChiefSteps`
requeueing with `machineId` cleared) while its daemon or in-server Coordinator
mirror still has rows in flight, and the next turn has since been claimed, the
late rows are tagged with the next turn's `scopeProjectId`. The project view
then shows the reply under the wrong project and hides it from the right one.

## Interaction with #2556

`dad56c833` (landed while this was in the queue) bounds a force-stopped turn:
`ownedStep` now also requires `status='claimed'`, so the daemon's late live
reports (`transcript_row`, `toolcall`) and the final `transcript.json`
`receiveUpload` are refused with 404 rather than written — the mistag can no
longer occur on those paths. The writes that still land on a settled step are
the `ownedStepRow` paths: the background-task report (which orphans a running
task) and the in-server `transcriptRow` mirror / restart repair. Those are the
paths this change has to tag correctly; the claimed-only paths get the same
explicit value for consistency.

## Wire protocol — measured, no new field

The producing step id already reaches the server on every path that writes
transcript rows, and it is always verified against `ownedStep` or the
server-held `PendingUpload` binding, so the daemon cannot tag rows with a step
it does not own:

| path | producing step carrier |
|---|---|
| `POST /api/machine/tool/:stepId` (`transcript_row`, `toolcall`) | `:stepId` path param → `ownedStep` (claimed only after #2556) |
| `POST /api/machine/tool/:stepId` (`bg_task`) | `:stepId` path param → `ownedStepRow` (lands on settled steps) |
| `PUT /api/machine/upload/:uploadId` (`transcript.json`) | `PendingUpload.stepId` bound by `POST /api/machine/upload-urls/:stepId` (`ownedStepRow` at bind time) and re-checked against `TranscriptUpload.stepId` in the body; `receiveUpload` requires `ownedStep` |
| `POST /api/machine/done/:stepId` (finish notes: quota hold, skill-injection check, fallback requeue) | `:stepId` path param → `ownedStep` / generation check |
| in-server Coordinator mirror (`server-api.ts` `transcriptRow`, `replayCoordinatorInputs`) | the `stepId` argument is the producing step; `ownedStepRow` accepts settled steps so a mirror can still land; the replay path resolves the producer per entry |

No new wire field is added. A parallel client-supplied field would duplicate
the bound step id, could disagree with it, and would have to be verified
against `ownedStep` anyway — the bound id is already that verified value.
**Old-daemon compatibility: none required.** `TranscriptUpload.stepId` has been
mandatory since the first daemon protocol and the `:stepId` params are in the
URL; an old daemon gets the corrected tagging without an upgrade. A
hypothetical sender missing `stepId` fails schema parse with 400, unchanged.

## Write paths and the change

`stepScopeProjectId(stepRow)` (`step.scopeProjectId`, falling back to the
picked-project id embedded in the step prompt) is the producing turn's own
project. Every chief-row write that holds the producing step row now passes it
explicitly as `projectId`; `upsertChiefRow`'s input accepts the optional field
and forwards it to `upsertChiefMessage`.

Machine / finish paths:

- `storeTranscriptRow` — the still-late path: reached from the in-server
  `transcriptRow` mirror (`ownedStepRow`, accepts settled steps) and from
  `reportTranscriptRow` (`ownedStep`, claimed only); tags with the row the
  caller verified.
- `reportBackgroundTask` — `ownedStepRow`, also accepts settled steps.
- `receiveUpload` (`transcript.json` batch) — `ownedStep`, claimed only after
  #2556; explicit value for consistency.
- `reportTool` — `ownedStep`, claimed only; explicit value for consistency.
- `holdStepForQuota`, `recordSkillInjectionCheck`, `requeueStep`,
  `finishCoordinatorTurn`'s `chief-err-` row — use the finishing `stepRow`;
  unreachable for a settled step after #2556, explicit value for consistency.
- `coordinator/index.ts` turn-prompt echo — same value the prompt-prefix
  branch of `writingTurnProjectId` already resolves; made explicit for
  consistency.

Untouched writes keep the `writingTurnProjectId` fallback because they run
synchronously inside the claimed turn (chief tool notices via the relay —
`executeRelayToolCall` rejects non-claimed steps — report acks, quick replies)
or already pass an explicit project (user sends, thread reports,
`recordChiefStop`). The prompt-echo prefix branch is also unchanged.

`message` (non-chief) rows have no `projectId` column and are unaffected.

## Failure behavior

- Step force-stopped (#2556 bound): `ownedStep` surfaces (live reports,
  `receiveUpload`, `done`) refuse with 404; the `ownedStepRow` surfaces
  (bg_task report, in-server mirror) still write and are tagged with the
  producing step's scope by this change.
- Step re-queued by `sweepAbandonedChiefSteps` (`machineId` cleared): the late
  write's ownership check fails with 404, retried as transient then dropped by
  the daemon; no rows written. Unchanged.
- Re-claimed step uploaded by a different machine: `ownedStep` machine check
  fails → 404. Unchanged.
- `body.stepId` ≠ bound `upload.stepId`: 404. Unchanged.
- Producing step has no scope: `projectId: null` — the row belongs to no
  project, which is correct; it must not borrow the next turn's project.
- Row already stored (upsert conflict): `projectId` is set on insert and not
  rewritten by the conflict-update, same as `origin`. Unchanged.
- Step row deleted between bind and upload: `conversationId` missing → 404.
  Unchanged.

## Out of scope

Tagging already-stored rows from past incidents: left as-is; the column is
written at insert time only.

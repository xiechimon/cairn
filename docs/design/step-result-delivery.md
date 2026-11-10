# Step result delivery

Status: draft for coordinator review. Design only; no code precedes approval. Evidence labels: **Observed** means read first-hand in the code at `98927e8`; **Inferred** means derived from it without a run; **Proposed** means a decision for review.

## Problem

A step's final report is delivered at most once per daemon process. When that one attempt fails, the step stays `claimed` on the server until the daemon restarts, and nothing on either side retries or releases it.

- **Observed.** `MachineClient.done` (`apps/daemon/src/machine-client.ts:516`) is one `fetch` through `request` (`:168`), with no retry and no timeout.
- **Observed.** On a failed report the runner logs and returns (`apps/daemon/src/runner.ts:2337-2343`). The journal entry stays `awaiting-upload` with its `doneBody`. A failed artifact upload returns the same way (`:2328-2334`) after 3 attempts 1s apart (`:2349-2350`).
- **Observed.** The step heartbeat is already stopped by then: host mode clears it at session end (`runner.ts:1947`) and `runStep` clears it in cleanup (`:404`).
- **Observed.** The only replays of an `awaiting-upload` entry are at daemon start (`apps/daemon/src/machine-loop.ts:575`) and once right after an Orb step (`apps/daemon/src/orb/step.ts:350-352`).
- **Observed.** The server does not release the step. `abandonedEnding` (`apps/server/src/services/builds.ts:2689-2701`) returns null when the machine is online and the step heartbeated at least once after its claim.
- **Observed.** `failStep` (`runner.ts:2472-2490`, 13 call sites) never journals the failure. If its report fails, the entry stays `claimed` or `running`, so a restart runs the agent again instead of reporting the failure.
- **Observed.** A 4xx on `done` is converted to a `failed` report only on the Orb path (`failOnRejectedDone`, `runner.ts:2447-2465`). In host mode a rejected report is never converted.
- **Inferred.** One dropped connection at the end of a step leaves the task showing as running for as long as the daemon stays up.

## Why the server guard stays

**Observed.** Host mode sends no heartbeat between session end and `done`: commit, push, PR probe, diff and upload all run in that window (`runner.ts:1947-2336`). The `online && progressed` guard is what keeps the sweep from releasing a step that is finishing.

**Proposed.** Do not add a server-side timeout for this state. Releasing a step whose executor is alive hands the same work branch to a second executor, which is the harm P1 and P2 of `verify-step-claim` exist to exclude, and it discards a finished run. The daemon holds the result, so the daemon delivers it.

## Design

The journal is already an outbox: an entry in `awaiting-upload` with a `doneBody` is a result that has not been acknowledged. The change makes delivery of that entry at-least-once while the daemon runs.

### Journal states

| State | Meaning | Written by |
| --- | --- | --- |
| `claimed` | Claim journaled, no session yet | `journal.claim` |
| `running` | Session open | runner |
| `awaiting-upload`, no `doneBody` | Session ended, collecting git facts | `runner.ts:2196` |
| `awaiting-upload`, with `doneBody` | Result ready, not acknowledged | `runner.ts:585`, `:2324`, `orb/step.ts:356`, and `failStep` (new) |
| removed | Acknowledged, or the server will never accept it | `journal.remove` |

The transitions are unchanged except one: `failStep` moves the entry to `awaiting-upload` with a `failed` body before it sends.

### Rules

1. **One delivery function.** Every result goes through `resumePendingUpload`. The first attempt after a step and every later attempt run the same code.
2. **Delivery loop.** `runMachine` starts a timer next to the existing sweep timers. Each pass takes `journal.pending()` entries in `awaiting-upload` with a `doneBody` and delivers those not already in flight. Per entry the delay after a failure is 5s, 15s, 60s, then 60s for every later attempt. The attempt count lives in memory; a restart starts over at 5s.
3. **Single flight per step.** A set of step ids guards delivery. The first attempt and the loop never send for the same step at once. The server applies a report in several statements with awaits before its fence (`machine-finish-step.ts:309-316`), so two concurrent reports for one claim would have the second one rejected with 409 and then converted by rule 5.
4. **Transient failure: keep and retry, without limit.** A network error, a 5xx, 408 or 429 keeps the entry. There is no give-up: the server stops waiting on its own once the machine goes offline, and after that rule 5 ends the entry.
5. **Rejection: report the failure once, then drop.** Any other 4xx on the original body replaces the journaled body with `failed` naming the status and response, in every mode. A 4xx on that `failed` body removes the entry and logs the step id, status and body. This is the Orb behavior made general, plus the missing drop.
6. **Upload failure does not block the report.** A transient upload failure keeps the entry and retries under rule 4. A non-transient one is logged and delivery continues to `done`.
7. **`failStep` journals first.** It writes the `failed` body to the journal, then delivers through rule 1. A restart replays the failure and does not open a session.

### Why a repeated report is safe

**Observed.** `finishStepReport` returns success without applying anything when the step is no longer `claimed` and still names this machine, or was released within the same team (`apps/server/src/services/machine-finish-step.ts:215-231`). A report whose response was lost is acknowledged on the next attempt. For a `failed` body that branch also calls `noteDeliveredPlanResidual`; rule 3 keeps the daemon from producing that call for a report that was applied as a success.

### Paths that read or write this state

One test per row.

| # | Path | Today | After |
| --- | --- | --- | --- |
| 1 | Normal finish, `done` fails transiently (`runner.ts:2337`) | logged; step stuck until restart | entry kept; loop delivers |
| 2 | Normal finish, upload fails transiently 3 times (`runner.ts:2328`) | logged; step stuck until restart | entry kept; loop retries upload and report |
| 3 | Normal finish, upload fails non-transiently | logged; step stuck until restart | logged; `done` still sent |
| 4 | Normal finish, `done` rejected 4xx, host mode | logged; step stuck, and every restart replays the same rejected body | `failed` body sent; entry removed on acknowledgement |
| 5 | Replacement `failed` body rejected 4xx (`runner.ts:2459`) | entry kept forever, counted as an active conversation by `sweepOrbs` (`machine-loop.ts:520`) | entry removed, logged |
| 6 | `done` applied, response lost | step is done on the server; daemon entry kept until restart | next attempt acknowledged by the idempotent branch; entry removed |
| 7 | `failStep`, report fails (13 call sites) | entry stays `claimed` or `running`; restart re-runs the agent | entry is `awaiting-upload` with a `failed` body; loop delivers; restart replays it |
| 8 | Local merge finish (`runner.ts:585`) | one attempt | same function, covered by rows 1 and 4 |
| 9 | Orb step finish (`orb/step.ts:350-359`) | one replay, then stuck | same function; the loop continues after the first replay |
| 10 | Startup, entry `awaiting-upload` with body (`machine-loop.ts:575`) | one attempt, serial | handed to the loop; startup does not wait for it |
| 11 | Startup, entry `awaiting-upload` without body | agent runs again | unchanged, see Out of scope |
| 12 | Startup, no journal for a recovered step (`machine-loop.ts:599`) | one unguarded `done(failed)` | unchanged, see Out of scope |
| 13 | Loop pass while the first attempt is in flight | n/a | skipped by the single-flight set |
| 14 | Machine goes offline while an entry waits; server releases the step and another machine finishes it | n/a | 404 on the original, 404 on `failed`, entry removed (rule 5) |
| 15 | Daemon stops with an entry waiting (`machine-loop.ts:827`) | entry survives on disk | unchanged; row 10 picks it up |
| 16 | Server `abandonedEnding` (`builds.ts:2689`) | waits forever on an online, progressed step | unchanged; rows 1 to 9 remove the cause |
| 17 | Server `recoverSteps` (`machines.ts:471`) | lists claimed steps of the machine | unchanged |

### Failure behavior

| Failure | Behavior |
| --- | --- |
| Server unreachable for hours | The entry waits and one attempt runs per minute. After 150s without presence the server marks the machine offline and may release the step (row 14). |
| Daemon crash at any point | The journal entry is on disk; row 10 or row 7 applies at the next start. |
| Journal file torn by a crash mid-write | `journal.get` returns null and the step is reported as lost (row 12). Not changed here. |
| Loop pass throws | Caught per entry and logged; other entries still run. |

## Verification

- `verify-step-claim` covers `finishStep`, recover and the runner's finish, so the model run is required. **Proposed:** add a `ReportLost(e)` action (the executor stays alive in `awaiting` and its report did not reach the server) and a `RedeliverReport(e)` action, and keep P1 to P8 at their expected results. P2 already accepts a replay of the same `doneBody` for the current claim.
- Unit tests in `apps/daemon/test` drive each row with a fake `MachineApi` and fake timers. Row 6 also gets a server test that posts the same body twice.

## Split

1. **PR 1, daemon only.** Rules 1 to 7 and the model actions. No wire change and no server change. Estimated under 400 lines outside tests.
2. **PR 2, separate design.** Reconcile claimed steps the daemon no longer knows about. It needs `claimedAt` on `StepRecord` so a pass cannot fail a step whose claim response is still in transit, which is a wire change and touches `apps/server/src/services/machine*.ts` (owner-routed).

## Out of scope

- Row 11: a crash between `runner.ts:2196` and `:2324` loses the session result and the agent runs again.
- Row 12 and a torn journal: covered by PR 2 and by making `writePrivateFile` atomic.
- A superseded executor that keeps running and pushes its branch after a partition.
- Serial startup recovery of steps that re-run the agent (`machine-loop.ts:594`). Row 10 removes only the replay case from that serial path.

## Open questions for the coordinator

1. Rule 6 sends `done` without the transcript after a non-transient upload failure. The alternative is to convert the step to `failed`. Recommended: send `done`, because the commit and PR already exist and the transcript is evidence, not the result.
2. Rule 5 changes host-mode behavior: a rejected report becomes a `failed` step where today it is stuck. Recommended: yes, since a stuck step has no owner and a failed one does.
3. Rule 4 has no retry limit. Recommended: keep it unlimited, with one log line per attempt after the third.

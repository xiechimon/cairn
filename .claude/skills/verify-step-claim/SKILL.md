---
name: verify-step-claim
description: TLA+ model checking (TLC, one command ~1 minute) of cairn's step claim / heartbeat / abandoned release / finish report / stop-on-close. Use when changing tryClaim, heartbeatStep, ownedStep, finishStep, sweepAbandonedBuildSteps, sweepStaleMachines, sweepQuotaWaitSteps, stopActiveStepsAfterExit, fetchStop, the scheduler tick order, or the daemon's claim loop, recover, deliverStop, runStep heartbeat / session registration / finish; judge whether a change makes "the same step run in two places at once", "an old executor's result being accepted", "being claimed again after close", or "an accepted stop signal being lost" better or worse.
---

# verify-step-claim

A step goes from pending to claimed by a machine, running, and reporting its result. Four parties touch it at once: the daemon (claim, heartbeat, report, recovery, stop delivery), the scheduler tick (offline machines, abandoned steps, quota-expired steps), the user (close, done, archive) and the environment (network loss, crash, time, re-binding the home machine). Tests cover the orderings their author wrote; TLC walks all orderings within a bounded range.

Model: `model/StepClaim.tla` (no comments except the first line; the action-to-code correspondence lives only in this file). One configuration per property: `model/P*.cfg`. Expected results: `expected.txt`. Sibling skill `verify-merge-gate` models whether a result may be merged; the runner contract is the same.

## When to run

Run when a change touches a function in the coverage record at the end or the sweep order of `tick`. Copy-only, log-line or step-status-unrelated changes do not need a run. When unsure, run.

```sh
.claude/skills/verify-step-claim/scripts/run.sh                              # every config in expected.txt
.claude/skills/verify-step-claim/scripts/run.sh P1_SingleExecutorPerMachine  # one
```

Prerequisites: Java 11+ and `~/.cache/cairn/tla2tools-1.7.4.jar`. When the jar is missing the script prints the download command and exits 2; it checks SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` (official v1.7.4). Override with `CAIRN_TLA_JAR`, `JAVA`. TLC intermediates go under `$TMPDIR`, never into the repo.

Each line of `expected.txt` is a config name, its expected result and, for expected-FAIL configs, the counterexample action sequence (comma-separated, excluding the initial state). `run.sh` strips the `__Variant` suffix of a config name to find the property it must violate.

Exit codes: 0 = every result and counterexample sequence matches `expected.txt`; 1 = one changed (a new violation, a known finding no longer violating, or a counterexample that took a different path, shorter or longer); 2 = tool or model error, including TLC reporting a violation that is not this config's property (for example `TypeOK`). At the end the script lists commits and uncommitted changes that touched covered files after `sync-commit`; when `sync-commit` is not in the local history it prints one note instead.

State counts and times were recorded at earlier commits and not re-measured: P1 to P7 explore millions of states each (8,016,012 recorded with the pooled claim), so plan the full run in tens of minutes.

## Properties

- **P1 `SingleExecutorPerMachine`**: on one machine, at most one runStep per step is preparing or running at any moment. Broken = two agents editing and pushing on the same branch in the same worktree (`workspace.ts` creates one worktree directory per conversation).
- **P2 `OnlyHolderResultApplied`**: the server only accepts the report from the executor of the current claim. Broken = an old executor's result rewrites the step and card while the new executor runs. A report not sent by the `holder` is a violation, except an `orphan` (the sender crashed while the server applied the report) that matches the current claim in the re-check after the await: the journal is already `awaiting`, and the executor `recover` starts replays the same `doneBody` through `resumePendingUpload`, so both are the same result. Without the exception the only counterexample is that path (claim, session, finish, ownership check, crash, recover, orphan landing).
- **P3 `NoClaimAfterClose`**: after the card closes or is marked done, this step never becomes claimed again. Broken = a closed task is picked up again by an agent.
- **P4 `AcceptedStopReachesWorkers`**: after the daemon handles a stop signal, every executor working on that step on this machine has been interrupted. Broken = after close the agent keeps running a full session round (quota, commits, possibly a PR).
- **P5 `ArchivedNeverClaimed`**: once the task is archived, its step never goes from not-claimed to claimed. The real guard is `isNull(todo.archivedAt)` in `claimCandidates`. `enqueueStep` has no `archivedAt` guard (each caller guards for itself), so the model adds `EnqueueAfterArchive`, an enqueue racing the archive, to make the claim guard matter.
- **P6 `ArchivedStopSettles`**: a claimed step of an archived task only stays claimed or becomes stopped; a done / failed / waiting_quota / pending outcome is never accepted.
- **P7 `ArchiveFlagMatchesStep`** (invariant): the archive flag is present exactly while an archived task's step is claimed. Whether an acknowledged stop reaches the running executor stays with P4: the archive signal travels `DeliverStopFetch` and `DeliverStopToRun` like a close.
- **P8 `OrbOnlyOnOrb`** (invariant): when the step requires the Orb (`RequiresOrb`), a claimed step sits on an Orb machine and every live or orphaned executor runs on one.

Archive (`stopActiveStepsForArchive` in `build-stop.ts`): pending and waiting_quota steps are stopped at once; a claimed step gets `archiveStop = requested` and a stop signal; `fetchStop` flips it to `acknowledged` and answers `discard: false`; the result paths (`finishStep`, `applyStepFailure`, `completeStep`, `releaseClaimedStep`) turn an archived step into `stopped`.

Pooled claim: the claim guard is `m \in Eligible`, not the home machine. The routing preferences and timers only restrict which eligible machine claims and when, so `TryClaim` and `TryClaimResponseLost` may fire on any eligible machine at any time, a superset of the real routing. `Eligible == {m \in Machines : ExecutorOk(m)}`, `ExecutorOk(m) == ~(ClaimChecksExecutor /\ RequiresOrb) \/ m \in OrbMachines`. Normal configs set `OrbMachines = {m1}`, `RequiresOrb = FALSE`, `ClaimChecksExecutor = TRUE`; `P8_OrbOnlyOnOrb` sets `RequiresOrb = TRUE`. A task's route override (`todo.routeOverride`) may add constraints but never drop a rule constraint; the model takes it as constants `OverrideRequestsDrop` and `MergeKeepsRule`, with `EffectiveRequiresOrb == RequiresOrb /\ (MergeKeepsRule \/ ~OverrideRequestsDrop)` feeding `ExecutorOk` while P8 still checks the rule's `RequiresOrb`. The P8 configs set `OverrideRequestsDrop = TRUE`.

## Negative controls

Each drops exactly the guard its property names; the counterexample is recorded in `expected.txt`. If an expected-FAIL config starts passing, the property or model has gone vacuous; fix that before trusting a PASS.

- `P5_ArchivedNeverClaimed__ClaimIgnoresArchive` (`ClaimChecksArchive = FALSE`): `ArchiveCard,EnqueueAfterArchive,TryClaim`.
- `P6_ArchivedStopSettles__ApplyIgnoresArchive` (`ApplyChecksArchive = FALSE`): `TryClaim,FinishSession,ArchiveCard,FinishStepOwnedCheck`, a failed report landing as `failed` on an archived task.
- `P8_OrbOnlyOnOrb__ClaimIgnoresExecutor` (`ClaimChecksExecutor = FALSE`): `TryClaim`, the host machine m2 claiming an Orb-required step.
- `P8_OrbOnlyOnOrb__OverrideDropsOrb` (`MergeKeepsRule = FALSE`): `TryClaim`. In code `withOverride` (`routing-rules.ts`) is a union with no way to subtract; its `executor` is `rule?.executor ?? override.executor`.

Manual mutations done once at handoff, not scripted:

- P3: make `abandonedEnding` in `build-abandoned-sweep.ts` always release instead of stop for a closed card, and set `release == stale`, `stopIt == FALSE` in the model's `SchedulerTick`. P3 then reports claim, stream abort, close, heartbeat timeout, sweep release, claimed again. Output: `evidence/run-p3-break.txt`.
- P1: revert the daemon claim loop's in-flight check (model `TryClaim` always creates an executor). P1 reports claim, heartbeat timeout, sweep release, same-machine re-claim.
- P2: revert the post-await re-check in `finishStep` (model `FinishStepApply` always lands). P2 reports claim, session, finish, ownership check, heartbeat timeout, sweep release, land.
- P4: `DeliverStopToRun` only sets `halt` on a `running` executor, giving `TryClaim,CloseCard,DeliverStopFetch,DeliverStopToRun` (stop dropped during preparation); `DaemonStartRecover` setting the new executor's `halt` to `FALSE` gives `TryClaim,CloseCard,DeliverStopFetch,DeliverStopToRun,DaemonCrash,DaemonStartRecover` (crash and restart after close).
- Real-code counterparts in `apps/daemon/test/` (`step-reclaim`, `machine-stop`, `runner-network-retry`, `machine-recover`) and `apps/server/test/step-claim-report.test.ts`.

## Findings

Checked against the code on 2026-11-16; the model's results were not re-run (no TLC here). Three findings in the original audit are fixed and kept as one line each, to explain model shape:

- **Same-machine re-claim (P1)** and **an old executor's report accepted (P2)**: fixed by #1473. The daemon heartbeats from `runStep` entry (the interval is cleared in `failStep` and at session end); the claim loop keeps an in-flight run when the same step is claimed again (`inFlight.has(stepId)` in `machine-loop.ts`); `finishStep` answers ok without writing when the step is no longer claimed and, after its awaits, throws a conflict unless the same machine and the same `claimedAt` still hold the claim. Model: `Carrier(m)` in `TryClaim`, `FinishStepOwnedCheck` / `FinishStepApply`.
- **A stop dropped during preparation (P4)**: fixed by #1495. `StepStops` / `RunStop` (`step-stops.ts`) keep one stop slot per step; `runStep` enters it at the start and persists the request to the journal's `stopRequest`; `deliverStop` (`machine-loop.ts`) fetches, looks the slot up and delivers; the session loop checks the request before opening a session, and `stop.attach` interrupts a session that opens late; recover passes a journaled `stopRequest` back into `runStep`. If the slot is gone (the run already settled) the stop is logged as dropped.
- **A lost report leaving the step executing forever (old F4, no property covered it)**: no longer holds as written. The daemon now re-delivers stranded `awaiting-upload` journal entries on a timer (`replayStrandedUploads` in `machine-loop.ts`, at most 40 attempts per step, after which the journal is left). Liveness is still not checked.
- `evidence/` holds pre-#1473 reproductions (`repro-server.test.ts.txt`, `repro-daemon.test.ts.txt`, `repro-output.txt`) and model runs (`run-full.txt`, `run-p3-break.txt`) as historical snapshots.

Mismatches between the model and the code, assessed on 2026-11-16 by reading the code against the model; TLC was not re-run:

- `silentSinceDrop` and the `dropConnection` grace (`machine-wake-hub.ts`): after its stream drops the machine stays online for a grace period and counts as not live until it shows presence again. The model's `MachineStreamAbort` takes it offline at once and `MarkPresence` brings it back, which covers the same states earlier. No effect found.
- `abandonedEnding` stopping a step whose build is no longer the todo's latest, and `releaseClaimedStep` failing a step after `ABANDONED_CLAIM_QUARANTINE_LIMIT` (3) claims without progress: both end the step as stopped or failed and neither can create a claim, so P3, P5 and P6 are unaffected. Observation, outside P4: `stopStepKeepPhase` marks the step stopped and deletes its `stop_pending` row but sends no stop signal, so the sweep itself does not interrupt an executor that is still running; how that executor learns of the stop was not checked.
- `tick` also runs `sweepAbandonedChiefSteps`, `sweepAbandonedMemoryEditSteps`, `sweepAbandonedShipSteps` and `sweepUnplaceableSteps`: chief and ship-gate steps are outside the model (a coverage gap, not a contradiction) except the chief force-stop, which `ForceStopChiefTurn` over-approximates (see its correspondence entry); `sweepUnplaceableSteps` ends pending steps and cannot create a claim.
- `finishStep` rejects a report whose `generation` differs from `claimedAt` before any write (`machine-finish-step.ts`): it rejects more than the model does, which only strengthens P2.
- `heartbeatStep` answers 410 when the step row no longer exists (`machines.ts`) and 404 when it is not claimed (`ownedStep` since #2556), after which `runStep` delivers a stop to itself (`HeartbeatRefused`): the model never deletes a step, so only the 404 arm is modeled. The server side was checked; the executor side was not.

If any property turns FAIL later, first apply "How to tell a real bug from a model mistake"; do not weaken the property or model to make it pass.

## How to tell a real bug from a model mistake

Take the counterexample and the correspondence below and ask, step by step, whether each step can happen from that state in the code.

- Every step maps to code and its preconditions hold: a real bug. Write it up in the code's terms; do not change business code unless asked.
- A step is impossible in the code (a looser precondition, a synchronous block split in two, a check missing from the model): a model mistake. Fix the model, note what was wrong, run again.
- When unsure, write an uncommitted reproduction test (`bootServer()` on the server, `FakeMachineApi` in `apps/daemon/test/machine-loop-harness.ts` on the daemon) and walk the real code.

## Action to code correspondence

The server is single-process with synchronous SQLite writes, so code between two `await`s cannot interleave; the model splits actions by `await`. Function names are stable; line numbers are deliberately not recorded.

- `TryClaim(m)` / `TryClaimResponseLost(m)`: `tryClaim` in `machine-claim.ts` (worker branch, `status = pending`), writing the lease through `acquireWorkerStepLease` in `step-lease.ts` and reached through `claimStep` long polling. Daemon side: the claim loop in `machine-loop.ts` skips a step id already in `inFlight` (`Carrier(m)`), otherwise starts `runStep`, which enters its stop slot and calls `journal.claim` in the same synchronous segment as the response. ResponseLost = the server wrote claimed and the daemon did not receive the response; an in-flight executor on this machine is still the executor of that claim (the server judges ownership by machine id).
- `StartSession(e)`: the session loop in `runner.ts` and `step-pass-loop.ts`. The preparation period (`workspace.prepare`, setup) is `preparing`. With a pending stop request no session opens (`FinishSession` gives stopped); otherwise `stop.attach` interrupts a session that opens while a stop is held.
- `HeartbeatStep(e)`: the interval in `runStep` (failure swallowed except the 404/410 case; sent in `preparing` and `running`) to `heartbeatStep` in `step-lease.ts` (re-exported by `machines.ts`), which checks machine id and `status = claimed`.
- `HeartbeatRefused(e)`: a heartbeat answered 404/410 because the step is no longer claimed or no longer this machine's. `runner.ts` then calls `stop.deliver({ discard: false })` on the run's `RunStop` slot (skipped when a request is already held, `~ex[e].halt`), which interrupts the session (`halt = TRUE`).
- `FinishSession(e)`: session end clears the heartbeat, `step-finish.ts` reads and settles the stop slot, then `journal.update(awaiting-upload)`. A preparation failure goes through `failStep` (model gives `failed`); a stop request before a session opened gives `stopped`. `ex[e].halt` = this run holds a stop request.
- `FinishStepOwnedCheck(e)` / `FinishStepApply(e)`: `finishStep` / `finishStepReport` in `machine-finish-step.ts`. First `ownedStep`; a step no longer claimed only reclaims the git credential and answers ok. Only a success report can await (`mergedPrElsewhere`, landing), so only success splits into two steps; after the await the re-check is same machine, same `claimedAt`, still claimed, else conflict. Writes: quota to `applyQuotaWaitStep` (`quota-wait.ts`); success to `completeStep` (`build-step-complete.ts`); stopped to `applyStoppedStep` (`build-stop.ts`); failed to `applyStepFailure` (`build-step-failure.ts`); all clear `stop_pending` first.
- `SchedulerTick`: one atomic `tick` in `scheduler.ts`: `sweepStaleMachines`, then `sweepAbandonedBuildSteps` (first stop pending / waiting_quota steps of closed, done or archived todos, then judge claimed steps: heartbeat older than 120s and (machine not live or heartbeat never advanced) gives `stop` for a closed or archived card or `release` otherwise), then `sweepQuotaWaitSteps`.
- `ForceStopChiefTurn`: `stopClaimedChiefStep` in `chief-turns.ts` (#2556): a claimed chief turn whose `stop_pending` row is older than `CHIEF_TURN_STOP_GRACE_MS` is force-stopped server-side even while heartbeats keep landing. The model has no clock and no step kind, so the action fires whenever `stopPending` holds on a claimed step — a superset of the real timing and of the worker-step semantics (worker steps never get this path; for the model's single step it just adds the settle). Same settle as the close path requests: `stopped`, `stop_pending` deleted, claim void.
- `CloseCard`: `stopActiveStepsAfterExit` through `prepareStopFor` (`build-stop.ts`): pending / waiting_quota stop at once, claimed writes `stop_pending` and `stopSignal`.
- `ArchiveCard`: `setTodoArchived` (`todos.ts`) then `stopActiveStepsForArchive` in one synchronous segment from the route in `routes-todos.ts`. `EnqueueAfterArchive` = `enqueueStep` (`builds.ts`).
- `ClaimAllowed` = `claimCandidates` (`machine-claim.ts`). `SettledAs` = the `archiveStop` checks in `finishStep`, `applyStepFailure`, `completeStep`, `releaseClaimedStep`. `Eligible` = `machineEligibility` (`dispatch-eligibility.ts`) through `workerIneligibility` (`machine-routing.ts`) in the worker loop of `tryClaim`; `ExecutorOk` = `missingCapabilityItems`, where a machine without `capabilities.executor === 'orb'` fails an `executor: 'orb'` requirement; `RequiresOrb` = the session rule's `requiredCapabilities.executor` (`routeProfile` in `routing-rules.ts`). The grace and overflow timers in `routeVerdict` are not modelled.
- `DeliverStopFetch(m)` / `DeliverStopToRun(m)`: `deliverStop` in `machine-loop.ts`: `client.stop` to `fetchStop` (returns and deletes the row only when claimed and the machine id matches), then in the same synchronous segment finds this step's slot and calls `RunStop.deliver` (records the request, writes journal `stopRequest`, interrupts an open session). Model: `jstop`, the Working executor's `halt`.
- `MarkPresence(m)` / `PresenceAges(m)`: `markPresence` in `machines.ts`, called by the daemon at start and on a 30s timer.
- `DaemonCrash(m)` / `DaemonStartRecover(m)` / `DaemonRecoverDone(m)`: `recoverSteps` (claimed steps of this machine) and the recover block in `machine-loop.ts`: a journal in awaiting-upload only re-reports, otherwise `runStep` runs with `stopRequest` pre-seeded from the journal (model: new executor `halt = jstop`); no journal means report failed; during recover no stream push, presence or claim. The journal is on disk, so `jstop` survives a crash. A report being applied when the daemon crashes becomes an `orphan`: the server still finishes it, but this machine's journal is no longer touched.
- `MachineStreamAbort(m)`: the push stream's `onAbort` in `routes-machine.ts` (see the mismatch note). Allowed at any moment while the machine is online; it drops stop events not yet delivered.
- `HeartbeatAges`, `QuotaProbeDue`, `Partition(m)`, `Reconnect(m)`, `RebindHomeMachine(m)`: time, network, and the user re-binding an agent's home machine.

## Bounds and assumptions

- Scale: 2 machines (m1 the initial home), 1 task, 1 build, 1 step, at most 2 executions (`ExecIds = {1, 2}`, `MaxClaims = 2`), network loss at most once (`MaxPartitions`), daemon crash at most once, home re-bind at most once, one late enqueue. Pass means all orderings within these bounds satisfy the properties, not that the whole system is correct.
- No clock model: a running executor on this machine with the network up and a heartbeat landed before counts as fresh (30s beat well under the 120s threshold); presence likewise (30s well under the 150s offline threshold, `MACHINE_STALE_OFFLINE_MS`). This relies on the event loop not blocking for over 90 seconds.
- One machine has one daemon at a time (`spawnSupervisor` in `supervisor.ts` refuses when a live daemon exists); when it crashes its executors end with it. Whether the claude-code subprocess survives as an orphan was not verified.
- The stop event is pushed at close time only to daemons that are online and up; no replay after disconnect (code and model agree). A stop is also lost when the pull response is dropped before the daemon receives it: the server already deleted the row and the journal is not yet written; `stopDelivered` stays unset and P4 does not count it.
- Only "still executing" versus "left execution" is distinguished (`hasLeftExecution` in `build-stop.ts`); P3 and P4 look at the latter.

Not in scope: liveness; chief steps and ship-gate merge steps; concurrency-cap, capability and runtime gates; several steps per build, reopen and new builds, scheduled re-runs, the CI green-wash loop, steer; unarchive; `holdStepForQuota` (a clock-less model cannot express its backoff); a stop event lost to disconnect with nobody re-sending it; a report rejected as a conflict (the new claim then waits for the heartbeat sweep); cross-machine dual execution (after a release or re-bind another eligible machine may run a second copy, unavoidable for a lease; P1 covers same-machine only); several server instances on one DB.

## After a code change

1. Run `run.sh` and read every commit it lists after `sync-commit`.
2. Judge each: no effect on the model, the model must follow, the promise intentionally changed (needs a commit note, test or doc as evidence), or the promise may break.
3. Change the model per the code, not per the result. One synchronous code block stays one model action; a new `await` splits it. Keep action names matching code function names and update the correspondence above.
4. Change a property only when the promise intentionally changed, and write the old wording, the new wording and the evidence here. Never weaken a property or shrink a bound to make it pass.
5. Re-run. A FAIL turning PASS needs two confirmations first: the code really fixed it, and redoing the breaking action makes the model report it again. Then update `expected.txt`.
6. Once the model describes the newly committed code, move `sync-commit` to that commit (this repo squash-merges: use the commit on main).

## Coverage record

`run.sh` reads two things below: the `sync-commit` line and the `coverage` code block (each line a two-space-indented path). `sync-commit` was not advanced by the archive and pooled-claim changes, and covered code has drifted since; it has not been re-read against the model in full (see the mismatch list). At 7edb3acfc only the steer/stop send-hold-ack surface (`fetchSteer`, `ackSteer`, `fetchStop`, daemon `deliverSteer`/`deliverStop`/reconnect re-fetch) was re-read against the model; earlier drift in other covered files remains unreviewed.

sync-commit: 7edb3acfc

```coverage
  apps/server/src/services/machines.ts
  apps/server/src/services/machine-deps.ts
  apps/server/src/services/chief-turns.ts
  apps/server/src/services/step-lease.ts
  apps/server/src/services/machine-claim.ts
  apps/server/src/services/machine-routing.ts
  apps/server/src/services/dispatch-eligibility.ts
  apps/server/src/services/builds.ts
  apps/server/src/services/build-abandoned-sweep.ts
  apps/server/src/services/build-step-complete.ts
  apps/server/src/services/build-step-failure.ts
  apps/server/src/services/quota-wait.ts
  apps/server/src/services/scheduler.ts
  apps/daemon/src/machine-loop.ts
  apps/daemon/src/runner.ts
  apps/daemon/src/step-final-upload.ts
  apps/daemon/src/journal.ts
  apps/daemon/src/step-stops.ts
  apps/daemon/src/workspace.ts
```

Covered functions: `machines.ts`'s `fetchStop`, `markPresence`, `sweepStaleMachines`, `recoverSteps`; `step-lease.ts`'s `heartbeatStep`, `acquireWorkerStepLease`, `releaseStepLease`; `machine-deps.ts`'s `ownedStep`; `machine-claim.ts`'s `tryClaim`, `claimStep`, `claimCandidates`; `machine-finish-step.ts`'s `finishStep`; `build-abandoned-sweep.ts`'s `sweepAbandonedBuildSteps`, `releaseClaimedStep`; `build-stop.ts`'s `stopActiveStepsAfterExit`, `stopActiveStepsForArchive`, `prepareStopFor`, `stopStepKeepPhase`, `applyStoppedStep`; `build-step-complete.ts`'s `completeStep` (up to the step-status write and the `hasLeftExecution` judgment); `build-step-failure.ts`'s `applyStepFailure`; `quota-wait.ts`'s `applyQuotaWaitStep`, `sweepQuotaWaitSteps`; `scheduler.ts`'s `tick` sweep order; `machine-loop.ts`'s startup presence, recover, `deliverStop`, claim loop; `runner.ts`'s stop-slot entry, journal write, `journal.claim`, heartbeat start and stop, session registration and the pre-session stop check, finish report; `journal.ts`'s status and `stopRequest`; `step-stops.ts`'s `RunStop`, `StepStops`; `workspace.ts`'s worktree directory and project lock.

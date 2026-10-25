---
name: verify-step-claim
description: TLA+ model checking (TLC, one command ~1 minute) of cairn's step claim / heartbeat / abandoned release / finish report / stop-on-close. Use when changing tryClaim, heartbeatStep, ownedStep, finishStep, sweepAbandonedBuildSteps, sweepStaleMachines, sweepQuotaWaitSteps, stopActiveStepsAfterExit, fetchStop, the scheduler tick order, or the daemon's claim loop, recover, deliverStop, runStep heartbeat / session registration / finish; judge whether a change makes "the same step run in two places at once", "an old executor's result being accepted", "being claimed again after close", or "an accepted stop signal being lost" better or worse.
---

# verify-step-claim

A step (a `step` row) goes from pending to being claimed by a machine, running, and reporting its result; in between, four parties touch it at once: the daemon (claim, heartbeat, report, restart recovery, stop delivery), one server scheduler tick (flipping offline machines, sweeping abandoned steps, releasing quota-expired steps), the user (close / mark done), and the environment (network loss, process crash, time passing, re-binding the home machine). Tests only cover the orderings the test author thought of; this skill uses TLC to walk **all** orderings within a bounded range.

Model: `model/StepClaim.tla` (no comments except the first line; the action-to-code correspondence lives only in this file). One configuration per property: `model/P*.cfg`. Expected results: `expected.txt`.

## When to run

Run when a change touches any of the listed functions in the "coverage record" below, or changes the sweep order of `tick` in `scheduler.ts`. Copy-only, log-line, or step-status-unrelated field changes (PR backfill content, token accounting, transcript) do not need a run. When unsure, run.

## How to run

```sh
.claude/skills/verify-step-claim/scripts/run.sh            # all four, ~1 minute on 8 cores (all four PASS, ~ten-odd seconds each depending on machine load)
.claude/skills/verify-step-claim/scripts/run.sh P1_SingleExecutorPerMachine   # just one, a few seconds
```

Prerequisites: Java 11+ (locally `~/.sdkman/candidates/java/current/bin/java`, 17.0.7) and `~/.cache/cairn/tla2tools-1.7.4.jar`. When the jar is missing the script prints the download command and exits 2; the script checks SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` (the official v1.7.4 release, 2,274,532 bytes). Paths can be overridden with `CAIRN_TLA_JAR`, `JAVA`. All TLC intermediates are written under `$TMPDIR/verify-step-claim.*`, never into the repo.

Each line of `expected.txt`: config name, expected result; expected-FAIL ones also record the counterexample action sequence (comma-separated, excluding the initial state). Expected-FAIL properties run single-threaded (a few hundred to a few thousand states, one or two seconds), and the counterexample is deterministic; expected-PASS ones use all cores.

Exit codes:
- 0 = every result matches `expected.txt`, and expected-FAIL counterexample action sequences match too.
- 1 = one changed: a new violation, a known finding no longer violating, or a known finding's counterexample took a different path. The last one also counts: the same property now has a shorter new path, or the old path got blocked leaving a longer one.
- 2 = tool or model error, including TLC reporting a violation that is not this config's property (e.g. `TypeOK`).

At the end the script lists commits and uncommitted changes that touched covered files after `sync-commit`; when `sync-commit` is not in local history (shallow clone) it prints a single note instead.

## Four properties (one promise + one harm each)

- **P1 `SingleExecutorPerMachine`**: on one machine, at most one runStep per step is preparing or running at any moment. Broken = two agents editing code and pushing on the same branch in the same worktree (`workspace.ts:122` builds the directory by session number).
- **P2 `OnlyHolderResultApplied`**: the server only accepts the report from the executor of the current claim. Broken = an old executor's result rewrites the step and card while the new executor is still running; the card flip-flops between "review" and "failed".
  - The ghost-variable wording since #1473 (unchanged wording): the old wording "a report not sent by the `holder` is a violation"; the new wording adds one exception: an `orphan` (the daemon that sent the report has crashed) does not count if, in the re-check after the await, it matches **the current claim**. Evidence: an `orphan` can only come from `applying`, by which point the journal is already `awaiting`; the executor that `recover` starts after a restart goes through `resumePendingUpload` and replays the same `doneBody`, so the two are the same result of the same execution. Without this exception, the only counterexample TLC reports is exactly this one (claim → session → finish → ownership check → daemon crash → recover → orphan landing).
- **P3 `NoClaimAfterClose`**: after the card closes / is marked done, this step never becomes claimed again. Broken = a task the user closed gets picked up again by an agent.
- **P4 `AcceptedStopReachesWorkers`**: after the daemon handles a stop signal, every executor working on that step on this machine has been interrupted. Broken = after the user closes the card the agent keeps running the full session round (burning quota, pushing commits, possibly opening a PR).

## Current results and known findings (at sync-commit)

`P1 PASS`, `P2 PASS`, `P3 PASS`, `P4 PASS` (685,236 distinct states each, ~ten-odd seconds each on 8 cores). F1 / F2 fixed by #1473, F3 fixed by the stop-delivery fix (below). After the F3 fix stop no longer delivers through the session handle, so the model dropped the two variables `handle` / `stopReq`, and the state count dropped from 794,525 to 685,236. If any becomes FAIL later, first judge with "how to tell a real bug from a model mistake"; **do not weaken the property or model to make it pass.**

`sync-commit` points at the squash commit 93b9ce21 of #1495 (the F3 fix). This repo squash-merges, so branch commit ids are not on main after the merge: after syncing a model change post-merge, push `sync-commit` to that squash commit.

F1 and F2 were fixed by #1473 (the original findings are kept below for comparison):
- The daemon starts the heartbeat at `runStep` entry, stops it before session end and before the failure report, and `finally` catches the remaining exits (`runner.ts:423-454`, `failStep` 2338). Model: `HeartbeatStep` / `KeepsFresh` hold in `preparing` too, `StartSession` no longer clears `beat`.
- The daemon claim loop: if the claimed step id is already in `inFlight`, start nothing (`machine-loop.ts:672`); the in-flight one is executor of this new claim. Model: `TryClaim` / `TryClaimResponseLost`, when this machine has a `Live` executor, only hand `holder` to it (`Carrier(m)`), create no new executor, touch no journal.
- Server `finishStep`: if the step is no longer claimed (registered to this machine, or already released, or unregistered and same-team), answer ok and only reclaim the git credential (`machines.ts:1788-1799`); the post-await re-check "same machine, same claim (`claimedAt`), still claimed", mismatch = 409, before that no step / build / card writes (`machines.ts:1827-1836`). Model: `FinishStepOwnedCheck` judges `st` first when `sm = m` or (`sm = NoMachine` and not claimed), success records `seen = claims`; `FinishStepApply` discards when the re-check fails (daemon side = done failed, journal retained).

**F1 (P1, fixed) same-machine re-claim, two executors on one step.**
1. Machine m1's daemon claims the step (`tryClaim`), runStep starts preparing the workspace (clone / wait for the project lock / `.agents/setup`, the latter up to 20 minutes).
2. The heartbeat timer starts only after preparation finishes (`runner.ts:1133`), so no heartbeat lands for 120 seconds.
3. One scheduler tick: step claimed, heartbeat over 120s, `lastHeartbeatAt` never advanced → `sweepAbandonedBuildSteps` releases it back to pending and clears `machineId` even while the machine is **online**, and wakes the waiting claim requests.
4. The same daemon's claim loop claims it again immediately (only m1 is the home machine; the claim loop does not check whether this step is already running on this machine, `machine-loop.ts:666-689`) → a second runStep.
A laptop lid close or over 150s of network loss also reaches here (the machine is first flipped offline by `sweepStaleMachines`, then released).

**F2 (P2, fixed) an old executor's report is accepted.** Continuing F1 step 4: the first runStep's preparation fails (e.g. setup failure) and reports `done(failed)` → `ownedStep` only compares the machine id (`machines.ts:1265-1270`) → accepted, step failed, card failed, while the second runStep is still running. Neither `finishStep` nor `completeStep` checks the step's current status, so the second executor's later report is accepted too. A single claim can also violate (confirmed with a diagnostic invariant during handoff, the window is narrow): a success report passes `ownedStep`, and during the await (`mergedPrElsewhere` querying GitHub / `applyMergeLanding`) the sweep releases the step back to pending, and after the await it still lands as done.

**F4 (no property covers it, inferred) a report lost once, the step stuck in executing forever.** The model reached this 8-step path with a diagnostic invariant; the real code was never run:
1. Session started, heartbeat landed (`lastHeartbeatAt` advanced).
2. Network loss, session ends, `client.done` throws (`machine-client.ts`'s `request` does not retry), the runner keeps the journal and returns directly (`runner.ts:2228-2234`).
3. Network recovers, presence normal, machine online.
4. Sweep: heartbeat timed out, but the machine is online and the heartbeat had advanced → treated as an ambiguous state, untouched (`builds.ts:1515-1524`). No executor, no one re-reports, until the daemon restarts and recover runs.
All four properties are safety properties and cannot catch "never progresses"; catching that needs a liveness property with a fairness assumption (see "not in scope").

**F3 (P4, fixed) a stop signal received during preparation is dropped.**
Before the fix (23a39da9): the step is claimed by m1, runStep is still preparing (the session handle registers only after the session opens) and the user closes the card → `stopActiveStepsAfterExit` writes `stop_pending` and pushes a stop event → the daemon's `deliverStop` pulls it via `fetchStop` and discards it, the server deletes the `stop_pending` row right away → `sessionHandles.get(stepId)` is empty, it records a `stop dropped (no live session)` line and returns → the session starts and finishes normally, reporting success. Two more paths reach the same outcome: under F1's two-executor state a stop only delivers to the latest registered session (`sessionHandles` overwrites per step id; after #1473 a machine no longer has two executors); the daemon crashes and restarts after the close, recover re-runs this step per the journal, and the server's stop record is already deleted.
Fix (the server's pull-is-ack unchanged, `fetchStop` still deletes the row):
1. Stop delivers to the run, not the session handle (`apps/daemon/src/step-stops.ts`). runStep registers this run's stop bit on entry (`runner.ts:437`); `deliverStop` delivers when it finds this step's stop bit on this machine (`machine-loop.ts:529-534`), otherwise it still records `stop dropped (no live session)`. Before the session opens it only records the request; the session loop checks for the request at the top of each round and, when found, does not open a session (`runner.ts:1451`) and goes straight to the normal finish: discard rollback, transcript upload, report `done(stopped)`. One arriving mid-session-start interrupts the session as soon as it opens (`runner.ts:1494`). The finish reads the stop bit and settles and unregisters it (`runner.ts:1832`); a stop arriving after that finds nothing.
2. Stop delivery records the request synchronously into the journal's `stopRequest`, and the interrupt-call throw erases it (`runner.ts:437-445`; a write failure only logs, does not block delivery). recover sees the journal's stop and pre-seeds it into runStep (`machine-loop.ts:463`, `opts.stopRequest`), that round does not open a session, finishes as stopped, discard rolls back normally; awaiting-upload residue still reports by snapshot (the session already ran, completion first).
Verification: P4 PASS; reverting the fix in the model reports a violation again (see "prove the check can fail"). Tests first red then green: `apps/daemon/test/machine-stop.test.ts` "the accepted stop reaches this step's run on this machine (F3)", `runner-network-retry.test.ts` failure mode 5b, `machine-recover.test.ts` two "stop accepted before restart" tests.

### Reproduction evidence (measured at 23a39da9, before the F1 / F2 fix)

Test source, output, and `run.sh` output stored under `docs/verify/step-claim-tla/`: `repro-server.test.ts.txt`, `repro-daemon.test.ts.txt` (drop the `.txt` back into `apps/server/test/`, `apps/daemon/test/` to run, delete after running, they do not enter the product test set), `repro-output.txt`, `run-full.txt`, `run-p3-break.txt`.

- Server half (F1 / F2): under `apps/server/test/` use `bootServer()` to build an online machine + an agent bound to it + a pending build step; `claimStep` → advance 121s and run `sweepAbandonedBuildSteps` → step back to pending, `machineId` cleared → a same-machine `claimStep` returns the same step → the old executor's `heartbeatStep` accepted → the old executor's `finishStep(success)` accepted (step done, card review) → the new executor's `finishStep(failed)` also accepted (step failed, card failed).
- Daemon half (F1): `FakeMachineApi` from `apps/daemon/test/machine-loop-harness.ts`, `mePatch = { maxConcurrent: 1 }`, push the same `CLAIMED` twice (step s1) → `createSession` called 2 times, two `done(success)`.
- Daemon half (F3): the same harness, while `createSession` is hung push `{type:'stop', stepId:'s1'}`, `stopResponse = true` → log `stop dropped (no live session)` → after releasing, report `done(success)`, session `stop()` called 0 times. At fix time, rewrite into the committed test asserting the fixed behavior (see F3 "verification").

## How to tell a real bug from a model mistake

When TLC reports a violation, the script prints the counterexample: each step is an action name from the model, below it the variables this step changed. Take the action correspondence table below and ask step by step "can this step really happen from this state in the code":

- Every step maps to something in the code and its preconditions hold in the code too → real bug. Write the steps in the code's own terms (like F1-F3 above), report to the user, **do not change business code** unless the user asks.
- A step is impossible in the code (precondition looser than the code, one code-side synchronous block split into two steps, a code-side check missing from the model) → model mistake. Fix the model, document what was wrong, run again.
- When unsure, write an uncommitted reproduction test (using the three setups above) and walk the real code.

## Action ↔ code correspondence (line numbers for `runner.ts` / `machine-loop.ts` are at the F3 fix, the rest are at sync-commit)

The server is single-process, better-sqlite3 synchronous write: code between two `await`s cannot be interleaved by other requests. The model splits atomic steps by `await`, which is the core of fidelity.

- `TryClaim(m)` / `TryClaimResponseLost(m)`: the worker branch of `apps/server/src/services/machines.ts` `tryClaim` (924), the `status = pending` condition at 1077-1091; `claimStep` long polls 1240. Daemon side: the loop starting `apps/daemon/src/machine-loop.ts` 633, if the step id is already in `inFlight` skip (672, `Carrier(m)`), otherwise start runStep → register the stop bit on entry (`runner.ts:437`), `runner.ts:548` `journal.claim`, in the same synchronous segment as the claim response. ResponseLost = the server already wrote claimed, the daemon did not receive the response (the B-C7 handoff race); when this machine has an in-flight executor, it is still the executor of this claim (server ownership judges by machine id).
- `StartSession(e)`: `runner.ts:706` `workspace.prepare` ends → 1451 with a pending stop-bit request it does not open a session (in the model this run does not take StartSession, `FinishSession` gives stopped) → 1493 `sessionHandles.set` → 1494 `stop.attach` (a stop arriving mid-session-start lands here). Preparation period = `preparing` in the model. The heartbeat starts at runStep entry (432), not reset by session start.
- `HeartbeatStep(e)`: `runner.ts:432-434` (failure swallowed; sent in both `preparing` / `running`) → `machines.ts:1263` `heartbeatStep`, ownership only via `ownedStep` (1270, machine id only).
- `FinishSession(e)`: session end stops the heartbeat (`runner.ts:1803`), reads this run's stop bit and settles (1832) to decide the result, `journal.update(awaiting-upload)` (2217). Preparation failure goes through `failStep` (2338, stops the heartbeat first), the model only gives `failed`; a pending stop-bit request during preparation → 1451 does not open a session, takes the same finish reporting stopped, the model gives `stopped`. `ex[e].halt` = this run's stop bit has a request (already interrupted if the session opened).
- `FinishStepOwnedCheck(e)` / `FinishStepApply(e)`: `machines.ts:1776` `finishStep`. First `ownedStep`, step no longer claimed → only reclaim the credential, answer ok (1788-1799). Only a success report can carry `prUrl` (`runner.ts:2206`) or be a merge landing, so only it awaits at 1813 / 1820, hence only success splits into two steps; after the await re-check same machine, same `claimedAt`, still claimed, mismatch 409 (1827-1836); the rest validated and written in one synchronous block. Writes: quota → `quota-wait.ts:87` `applyQuotaWaitStep`; success → `builds.ts:1611` `completeStep`; stopped → `builds.ts:292` `applyStoppedStep`; failed → `builds.ts:1407` `applyStepFailure`; all clear `stop_pending` first (`machines.ts:1938`).
- `SchedulerTick`: `apps/server/src/services/scheduler.ts:130` `tick` one whole atomic tick, in order 179 `sweepStaleMachines` (`machines.ts:646`) → 186 `sweepAbandonedBuildSteps` (`builds.ts:1482`: first stop the pending / waiting_quota residue of closed / completed cards, then judge claimed: heartbeat timed out and (machine offline or heartbeat never advanced) → closed card `stopStepKeepPhase` (1522 → 414), otherwise `releaseClaimedStep` (1532)) → 192 `sweepQuotaWaitSteps` (`quota-wait.ts:142`).
- `CloseCard`: `builds.ts:465` `stopActiveStepsAfterExit` → 469 `prepareStopFor`: pending / waiting_quota stop immediately, claimed writes `stop_pending` + `stopSignal`.
- `DeliverStopFetch(m)` / `DeliverStopToRun(m)`: `machine-loop.ts:525` `deliverStop` first `await client.stop` → `machines.ts:254` `fetchStop` (returns and deletes the row only when claimed + machine id matches), then in the same synchronous segment find this step's not-yet-settled stop bit on this machine (529), record the request and write journal `stopRequest` (534 `RunStop.deliver` → `runner.ts:437-445`; model `jstop`, this machine's Working executor `halt`, at most one by P1), then interrupt an open session.
- `MarkPresence(m)` / `PresenceAges(m)`: `machines.ts:577` `markPresence`; once at daemon start (`machine-loop.ts:304`), then a 30s timer (577, starting only after recover ends).
- `DaemonCrash(m)` / `DaemonStartRecover(m)` / `DaemonRecoverDone(m)`: `machine-loop.ts:429` recover, `machines.ts:669` `recoverSteps` (claimed + this machine); with a journal: awaiting-upload only re-reports, otherwise `await runStep`, pre-seeding the stop request when the journal carries `stopRequest` (463; in the model the new executor `halt = jstop`); no journal → report failed; during recover no stream push, no presence, no claim. The journal is on disk, `jstop` survives the crash.
- `MachineStreamAbort(m)`: `apps/server/src/routes-machine.ts:317` the push stream's `onAbort` immediately `markOffline` and drops stop events not yet delivered. The model allows it at any moment while the machine is online (daemon exit, network loss, proxy killing the long connection, server restart all trigger it).
- A report being handled by the server (`applying`) when `DaemonCrash(m)` happens becomes an `orphan`: the server still walks through (writes if the re-check passed, drops with 409 otherwise), but the sending process is gone, so this machine's journal (including `jstop`) is no longer touched.
- `HeartbeatAges`, `QuotaProbeDue`, `Partition(m)`, `Reconnect(m)`, `RebindHomeMachine(m)`: time passing / network / the user re-binding an agent's home machine.

## Bounds and assumptions

- Scale: 2 machines (m1 is the initial home machine), 1 task 1 build 1 step, at most 2 executions (`ExecIds = {1, 2}`, `MaxClaims = 2`: two claims, or one claim + one recover), network loss at most once, daemon crash at most once, home-machine re-bind at most once. Orderings beyond these bounds are not checked. Pass = all orderings within these bounds satisfy the properties, not that the whole system is correct.
- Time has no clock model: "a running executor on this machine, network up, heartbeat has landed before" counts the heartbeat as fresh (30s beat ≪ 120s threshold), otherwise it can time out; presence likewise (30s ≪ 150s). This relies on the event loop not being blocked for over 90 seconds.
- One machine has one daemon at a time (`apps/daemon/src/supervisor.ts:32` single-instance lock); when the daemon crashes its executors end with it (whether the claude-code subprocess becomes an orphan process is unverified).
- The stop event only pushes at close-moment to daemons that are online and in the up state; no replay after disconnect (code does this, model does this).
- A stop is also lost when the pull response is dropped before the daemon receives it (crash, disconnect): the server already deleted the row, the journal not yet written. In the model `stopDelivered` is then unset and P4 does not count it.
- The state view `StateView` drops fields that do not affect later behavior (the heartbeat bit when not claimed, the probe bit when not waiting_quota, the journal result when not awaiting), used only for dedup.
- Only the card's "still executing" vs "left execution" is distinguished (`builds.ts:194` `hasLeftExecution`); P3 / P4 only look at the latter.

**Not in scope**: liveness ("eventually progresses / eventually gets stopped"), so F4-style stalls are only visible via a diagnostic invariant; chief steps (`chief.ts` has a separate sweep); the concurrency-cap gate, capability / runtime gates, missing model slot; ordering of multiple steps in one build (plan → build → review); reopen / new build, scheduled re-runs; the CI green-wash loop; steer; the old daemon's text-classifier quota hold (`holdStepForQuota`, protected by the 60s backoff > 15s tick timing, which a clock-less model cannot express); a stop event lost to disconnect with no one re-sending it (lets a post-close step run a full round, the model sets no property to catch it); after a report is 409-rejected (claim changed during the await), no one runs the new claim and it waits for the heartbeat timeout sweep to release and re-claim (liveness, not checked); cross-machine dual execution (after re-binding the home machine during network loss, two machines each running one copy is unavoidable for the lease mechanism, P1 only covers same-machine); multiple server instances on one DB; daemon orphan subprocesses.

## Update verification (after a code change)

1. Run `run.sh`, record the result. The end lists commits after `sync-commit` that touched covered files; read each diff.
2. Judge each change: does not affect the model (copy, unrelated fields) / the model must follow (atomic step split or merge, a condition changed, a new path writing the same fields) / the promise intentionally changed (must have a commit note, test, or doc as evidence) / may break the promise (no evidence of intent).
3. Change the model per the code, not per the result: write first then run. One code synchronous block stays one model action; a new `await` splits the action. Keep action names matching code function names, and update the correspondence table line numbers above.
4. Only change a property when the promise intentionally changed: write the old wording, new wording, and evidence in this file. Do not shrink bounds unless the change makes them invalid; if shrunk, say so in the report.
5. Re-run. Result changed: FAIL → PASS must first confirm the code really fixed it, then redo the breaking action in the code and confirm the model still reports it (next section), then update `expected.txt`; PASS → FAIL handled by "how to tell a real bug from a model mistake".
6. After confirming the model describes the newly committed code, push `sync-commit` below to that commit and update "current results and known findings".

## Prove the check can fail (done once at handoff)

In the real code, change `apps/server/src/services/builds.ts:1522`'s "abandoned claimed step of a closed / completed card → `stopStepKeepPhase`" to always `releaseClaimedStep`, follow step 3 to change the `stopIt` / `release` judgment in the model's `SchedulerTick` (`release == stale`, `stopIt == FALSE`), run `run.sh P3_NoClaimAfterClose`: with the model unchanged P3 still passes, but the end notes `builds.ts` has uncommitted changes; with the model changed P3 reports a violation (claim → stream abort → close → heartbeat timeout → sweep release back to pending → claimed again), exit 1. Output at `docs/verify/step-claim-tla/run-p3-break.txt`. Revert both the code and model changes and run again to confirm it returns to `expected.txt`. P4 is the F3 paragraph below.

After #1473 fixed F1 / F2, each got one:
- P1: revert the daemon claim loop's in-flight judgment (model `TryClaim` always creates a new executor), P1 reports a violation: claim → heartbeat timeout → sweep release → same-machine re-claim, i.e. the original F1 path. Entry heartbeat alone is not enough, `HeartbeatAges` can still happen before the first beat lands in the first tick (network loss likewise).
- P2: revert the post-await re-check in `finishStep` (model `FinishStepApply` always lands), P2 reports a violation: claim → session → finish → ownership check → heartbeat timeout → sweep release → land, i.e. F2's single-claim path.
- After reverting both, run the full set, returns to `expected.txt`. The corresponding real-code assertions are in `apps/daemon/test/step-reclaim.test.ts` and `apps/server/test/step-claim-report.test.ts`, all red before the fix.

After the F3 fix, once (P4, single-threaded in a model copy):
- `DeliverStopToRun` only sets `halt` on a `running` executor (stop only reaches a session-already-open run), P4 reports: `TryClaim,CloseCard,DeliverStopFetch,DeliverStopToRun`, i.e. a stop dropped during preparation.
- `DaemonStartRecover` changes the new executor's `halt` to `FALSE` (recover ignores the journal's stop), P4 reports: `TryClaim,CloseCard,DeliverStopFetch,DeliverStopToRun,DaemonCrash,DaemonStartRecover`, i.e. crash and restart after close.
- On the pre-#1473 model there is also the third path: stop only delivered to the latest registered executor, reports a violation (release then same-machine re-claim then close). After #1473 a machine has no two executors, that path does not exist, so the code has one stop bit per step.
- The real-code side is caught by the tests in F3 "verification": removing the stop check at the session-loop top, removing `stop.attach`, or making `settle` not unregister the stop bit, each makes the corresponding test red.

## Coverage record

`run.sh` reads two things below: the `sync-commit` line and the `coverage` code block (each line a two-space-indented path).

sync-commit: 93b9ce21

```coverage
  apps/server/src/services/machines.ts
  apps/server/src/services/builds.ts
  apps/server/src/services/quota-wait.ts
  apps/server/src/services/scheduler.ts
  apps/daemon/src/machine-loop.ts
  apps/daemon/src/runner.ts
  apps/daemon/src/journal.ts
  apps/daemon/src/step-stops.ts
  apps/daemon/src/workspace.ts
```

Covered functions: `machines.ts`'s `tryClaim`, `claimStep`, `heartbeatStep`, `ownedStep`, `finishStep`, `fetchStop`, `markPresence`, `sweepStaleMachines`, `recoverSteps`; `builds.ts`'s `sweepAbandonedBuildSteps`, `releaseClaimedStep`, `stopActiveStepsAfterExit`, `prepareStopFor`, `stopStepKeepPhase`, `applyStoppedStep`, `applyStepFailure`, `completeStep` (only up to the step-status write and the `hasLeftExecution` judgment); `quota-wait.ts`'s `applyQuotaWaitStep`, `sweepQuotaWaitSteps`; `scheduler.ts`'s `tick` sweep order; `machine-loop.ts`'s startup presence, recover (including the `stopRequest` branch), `deliverStop`, claim loop; `runner.ts`'s stop-bit registration and disk write, `journal.claim`, heartbeat start/stop, `workspace.prepare` and session registration / the pre-session-open stop check ordering, stop-bit read, finish report; `journal.ts`'s status and `stopRequest`; `step-stops.ts`'s `RunStop`, `StepStops`; `workspace.ts`'s session directory and project lock.
# Cross-runtime model fallback for chief, review and verify steps

A user whose Coordinator (chief) runs on a pi relay watches it go silent when the
relay runs out of quota or the model disappears: the turn parks on quota even
though a Claude Code subscription sits idle on the same machine. Same for a
review or verify step — the gate stalls instead of running the next configured
model. This change lets chief, review and verify steps take the model fallback
chain across runtimes (pi ↔ claude-code ↔ devin ↔ antigravity), the way build and
plan steps already can. The newcomer needs nothing new: fallback chains come from
the same routing rules (`routing_rule.fallbackModels`) they already configure;
machines advertise runtimes (`enabledRuntimes` / `claudeCodeReport` /
capabilities) and only ever see a step whose model they can run.

Redo of `B2/fallback-kinds` (d1b32105b) under D60 routing. Much of the old branch
landed through `step.ranModel` (claim pins the model it dispatches): credentials
(`resolveStepCredentials`, `resolveChiefStepCredentials`, `stepToken`), worker
machine eligibility (`workerIneligibility` on `effectiveModel`), chief machine
eligibility (`buildChiefClaim`, `serverTurnModel`) and the in-server provider
resolution already read the pinned model. What is missing: the fallback kinds do
not include review/verify, the chief planner still forbids a provider change, and
the three places that must judge the *attempt* (verdict reviewer identity, chief
session resume, stale reports) still read mutable state or nothing at all.

## Model

Every claim already pins `step.ranModel = {provider, modelId, thinkingLevel}`
(claim transaction for workers, `claimPendingChiefStep` for chief, in-server
`claimHead` for coordinator turns). The *attempt runtime* is
`stepRuntimeFor(ranModel.provider)` — derived, never stored separately.

### Persisted state

- `chief_thread.sessionRuntime` (existing column, default `'pi'`, previously
  never written or read): now means "the runtime that produced
  `chief_thread.sessionId`". Written in `finishChiefTurn` together with
  `sessionId`, from the finishing attempt's `stepRuntimeFor(stepRow.ranModel.provider)`.
  Rows written before this change keep `'pi'`: a thread whose last turn really
  ran claude-code loses exactly one session resume (self-heals on the next
  finish), which is safe — a wrong resume attempt is not.
- `gate_verdict.ranModel` (new nullable JSON column, `StepRanModel` shape):
  stamped by `persistGateVerdict` from `stepRow.ranModel` — the model that
  produced this verdict. NULL on legacy rows and on verdicts whose step pinned
  no model; the independence check fails closed in both cases.

### Claim protocol

`ClaimedStep.step` gains `generation` (the server `step.claimedAt` of this claim).
The daemon journals it inside `claimed` and echoes it as
`MachineDoneBody.generation` on every done report (deliver, stranded replay,
early-failure, orb, local-merge). `finishStep` already throws conflict when
`generation` is present and differs from the current `claimedAt`; reports without
`generation` (old daemons) get today's ownership checks. The in-server
coordinator tags its own `api.done` calls with the `claimedAt` it claimed under;
`serverApi.done` drops a report whose generation does not match the current
claim or whose claim is now owned by a machine — same rule, no wire.

## Read/write paths

- Claim (chief, machine): `claimChiefTurn`/`buildChiefClaim` gate the machine on
  `runtimeGatePasses(machineRow, effectiveModel.provider)` — the fallback
  runtime, not the rule's. `continuesSession` additionally requires
  `threadRow.sessionRuntime === stepRuntimeFor(effectiveModel.provider)`, so a
  turn on runtime B never resumes a session recorded by runtime A. The payload's
  `session.action` is `new` in that case.
- Claim (chief, in-server): `serverTurnModel` returns the pinned fallback model
  only while its runtime is `pi`; a non-pi pin leaves the step to machines.
- Claim (worker): unchanged — `workerIneligibility`, `priorSessionOf` and the
  claim transaction already use `effectiveModel` / pin `ranModel`.
- Fallback planning: `planModelFallback` serves `chief`, `review`, `verify` the
  same as `plan`/`build`/`session`. The old chief clause (backend runtime ⇒
  same provider) is removed; `runtimeGatePasses` against team machines, liveness
  and `providerHealth` keep the chain honest. `requeueStep` clears the claim;
  the next claim re-pins `ranModel` to the fallback model.
- Token: `stepToken`/`chiefStepToken` already resolve provider, keys and
  subscription binds from `ranModel ?? fallback.model`; unchanged. A chief step
  claimed on a pi relay fallback returns that relay's provider config, not the
  rule's.
- Finish: `finishCoordinatorTurn` hands `finishChiefTurn` the attempt runtime
  (`stepRuntimeFor(stepRow.ranModel?.provider)`); the thread row only records a
  session/runtime pair produced by the same claim.
- Verdict: `persistGateVerdict` stamps `gate_verdict.ranModel` for review and
  verify verdicts. Merge-gate inputs must feed `GateVerdictView.reviewerModel`
  from the verdict's `ranModel`, so `isCodexReviewModel` judges the model that
  actually ran — a review that fell back to the author's vendor no longer
  counts as an independent Codex review.

## Failure behavior

- Fallback target on a runtime no team machine has: `planModelFallback` skips it
  (`runtimeGatePasses`); the step keeps waiting quota as today.
- Chief fallback lands on a machine without the subscription the runtime needs:
  `buildChiefClaim` refuses (`chiefSubscriptionMissing`), the step stays pending
  until a suitable machine comes online.
- Stale report (superseded attempt): `generation` mismatch → conflict on the
  machine path; dropped on the in-server path. The thread's session binding is
  never overwritten by an attempt that no longer owns the claim.
- A report without `generation` keeps today's behavior exactly (backward
  compatibility for old daemons).
- Legacy `sessionRuntime = 'pi'` rows: at most one spurious fresh session per
  thread, then the column is truthful.

## Scenario table

| Situation | What happens |
| --- | --- |
| Coordinator on relay-a hits quota, fallback chain has claude-code | Step requeues, machine with claude-code claims it on a fresh session, `ranModel` pinned to claude-code; token resolves the subscription, `sessionRuntime` records `claude-code` |
| Next chief turn back on relay-a | `sessionRuntime` (`claude-code`) ≠ `pi` → new session, never resumes the claude-code session under pi |
| Same-runtime fallback (relay-a → relay-b, both pi) | Thread session resumes: runtimes match |
| Review step falls back to the author's vendor | Verdict stores the fallback model; independence check sees the ran vendor → `independent-review-missing` rather than crediting the configured reviewer |
| Old daemon reports after the step was reclaimed | No `generation` → existing machine-ownership check applies; a new daemon's report carries `generation` and is rejected on mismatch |

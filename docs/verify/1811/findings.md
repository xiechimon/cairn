# TLA+ model checking of the merge gate and of task claiming (#1811)

Exploratory ticket: no product code changes. Two decisions are modelled — whether a
GitHub PR may be merged, and whether a local patch may land on a default branch — and
the existing task-claiming model is re-audited at the current head.

Skill: `.claude/skills/verify-merge-gate/`. Run: `.claude/skills/verify-merge-gate/scripts/run.sh`.
Audited commit: `204491eb3468ce9f3f8941f65b7e43eaa3a3357a`.

Run outputs in this directory, captured at the audited commit:

- `merge-gate-run.txt` — all ten configs of the new skill, exit 0. The new skill's
  runner keeps stdout deterministic (the work dir, per-config timings and log paths go
  to stderr), so this file reproduces byte for byte on a fresh run.
- `step-claim-run.txt` — the sibling skill's four properties plus its drift list, exit 0.
  That runner prints the work dir and per-config timings to stdout, so those lines are
  per-run values; the verdicts, state counts and drift list are what this audit reads.
  Same convention as `docs/verify/1488/verify-step-claim.txt`.

## Results

| Property | Model | Result | Meaning |
| --- | --- | --- | --- |
| P1 `MergeBoundToJudgedPatch` | `MergeGate.tla` | PASS (45,508 states) | within bounds, no ordering merges a patch the gate did not judge |
| P2 `StaleVerdictNeverSatisfies` | `MergeGate.tla` | PASS (45,508 states) | a verdict on another patch never counts toward readiness |
| P3 `LocalLandingBindsJudgedPatch` | `LocalLanding.tla` | PASS (47 states) | no ordering lands a patch that was not judged against the base it lands on |

Violated properties, one per negative control: `P1N`, `P2N`, `P1H`, `P4` (merge gate)
and `P3A`, `P3B`, `P3C` (local landing). Each control drops exactly the guard its
property names, so each violation is the trace of that guard's absence, not a bug in
the code. They exist to prove the checks can fail; all seven counterexamples are frozen
in `expected.txt`.

## Findings

### F1 (P4, live gap) the REST merge path consults no verdict and no digest

The merge that runs today is `mergeThroughGithub` (`apps/server/src/services/builds.ts:1512`)
through `apiMergeGate` (`builds.ts:1453`): the card's phase and latest build, no step in
flight, then the PR's state, branch, author and base ref, then the checkpoint pin —
`builds.ts:1603` reads the checkpoint, `builds.ts:1610` requires
`pull.headSha === checkpoint`, `builds.ts:1618` merges with `sha: checkpoint`. Verdicts
with digests do exist by then: `persistGateVerdict` (`builds.ts:1334`) binds every
review/verify verdict to a head through `bindGateVerdict` (`verdict.ts:27`) and fills its
`patchDigest` from a compare read (`builds.ts:1422`, stored at `:1439`), and
`mergeReadiness` (`readiness.ts:156`) accepts only verdicts bound to the digest it just
computed (`readiness.ts:434`). The merge path reads none of that: no `mergeReadiness`
call and no verdict query anywhere in it.

Consequence in the model: `MergeRechecksDigest = FALSE` (config `P4_MergeRechecksDigest`).
TLC's counterexample is three verdicts → `Evaluate` → `BaseMoveInteracting` → merge: the
gate judged patch `d1` against base `b1`; the default branch moves to `b2`, so the diff of
the same PR head against it is now `d2`; the merge lands, because the head SHA did not move
and only the head SHA is checked.

Reachability, precisely. The gap is live: this path merges PRs today, and it does so
without reading any verdict or digest, so the property P4 names is not enforced here at
all — that is the finding. The counterexample trace itself cannot fire end-to-end today,
because its `Evaluate` step has no counterpart on the path: nothing evaluates the gate
there (F3), so no evaluation, stale or fresh, authorises or blocks this merge. The head-SHA
pin keeps the *commit* identity stable, so this is not a "wrong commit merges" bug; the
window is a base that moved between the gate read and the merge without conflicting. The
trace is the hazard the wiring must not reproduce: open PR #1821 (server(#1794)) adds the
gate's first caller — `merge-gate-run.ts` `evaluateMergeGate`, recording `gate_digest` per
build — without touching `mergeThroughGithub`; the moment a stored evaluation starts gating
this path, a merge that trusts it without re-deriving the digest at merge time lands
exactly the P4 trace.

Not fixed: this ticket adds no product code. The check to add later is a digest comparison
in `apiMergeGate` against the digest the verdicts were bound to.

### F2 (P1H, model-only) the review-head binding is load-bearing on its own

The independent-review filter requires both `v.patchDigest === D` and `v.headSha === head`
in one conjunction (`readiness.ts:335`, with the digest at `:434`). Dropping only the
head equality (`ReviewHeadBound = FALSE`, config `P1H_UnboundReviewHead`) still produces a
counterexample: three verdicts → `Evaluate` → merge, with the review verdict recorded at an
older head that carried the same patch digest — the evidence-only-commit case, which
`PushEvidence` models.

This is not a claim that the code lacks the check; it demonstrates that a future edit which
keeps the digest filter and loses the head equality is detectable, and that the two
conditions are not redundant.

### F3 (reachability boundary) `mergeReadiness` has no production caller

At sync-commit its only non-test references are its own definition
(`apps/server/src/services/merge-gate/readiness.ts:156`), the shared schema
(`packages/shared/src/records/merge-gate.ts:326`) and test fixtures; no product code calls
it, so P1 and P2 describe a function whose result nothing acts on yet. The scheduler and
chief wiring described in `docs/adr/0021` and `docs/spec/28` has not landed.

Open PR #1821 (server(#1794)) adds the first caller: `merge-gate-run.ts` `evaluateMergeGate`,
run from the ci-loop sweep, records `gate_digest` / `gate_round` / `gate_state` per PR
build. That PR does not touch `mergeThroughGithub`, so the REST merge still runs on the
checkpoint pin alone. Re-run this skill when a caller lands, settle F1's re-check question
before making the merge path trust a stored evaluation, and treat F1 as the thing to fix at
that point.

### F4 (P3 boundary) `decideLocalMerge` has no production caller either

`decideLocalMerge` (`apps/daemon/src/merge-decision.ts:17`) is referenced only by
`apps/daemon/test/merge-decision.test.ts`. Its two re-checks — patch stale (`:18`) and
default head moved (`:21`) — therefore never run in production.

The production local landing is `applyMergeLanding`
(`apps/server/src/services/machine-merge-landing.ts:20`), called from
`apps/server/src/services/machine-finish-step.ts:264`. It:

1. returns early for non-hosted projects (`machine-merge-landing.ts:30-31`);
2. refuses a non-fast-forward (`:39`);
3. skips when the card left review (`mergeCardLeftReview`);
4. updates the ref (`:45`).

It does not compare a patch digest or a judged base with the current ones, and
`judgedBase` / `judgedPatchDigest` appear nowhere outside `merge-decision.ts` and its test.
So P3 holds for the decision function, and the wiring that would make those two re-checks
happen has not landed. The fast-forward check is present and is what `P3B_NoFfCheck` proves
is load-bearing.

### F5 (task claiming) the claim CAS left the covered file set

`verify-step-claim` models claim, heartbeat, abandoned release, finish report and
stop-on-close. At this head all four properties still pass (685,236 distinct states each,
`step-claim-run.txt`).

Its coverage record lists `apps/server/src/services/machines.ts`, but the module split
`c7875358 server(1522): split services/machines.ts by responsibility` moved `tryClaim` /
`claimStep` into the new `apps/server/src/services/machine-claim.ts`, plus
`machine-finish-step.ts` and `machine-merge-landing.ts`. The skill's drift check reads only
its coverage record, so it no longer sees changes to the claim CAS, the finish-step
ownership re-check, or the landing path. The run at this head reported 45 commits touching
covered files since `sync-commit 93b9ce21` (the newest, `529efdc6 web+server(1939)`, added
chief-digest candidates to `machine-claim.ts` and touched the covered `runner.ts`, with the
CAS itself unchanged); none of the ones reviewed changed the modelled behaviour.
The merge-gate run at this head reports `covered code unchanged since sync-commit 204491eb`
(see `merge-gate-run.txt`), because the new skill's coverage record already lists the
post-split files.

Not edited here: this PR keeps its diff to the new skill and these docs. The fix for a
follow-up is to add `machine-claim.ts`, `machine-finish-step.ts` and
`machine-merge-landing.ts` to that coverage record and re-audit.

## Reachability summary

| Finding | Property | Reachable in the real code | Basis |
| --- | --- | --- | --- |
| F1 | P4 | no trace today; the missing call is live | `builds.ts:1453`, `:1603-1618` merge without a digest comparison; no `Evaluate` on the path, so the trace itself is not end-to-end reachable (F3) |
| F2 | P1H | no, model-only | the code holds both conditions in one filter (`readiness.ts:335`, `:434`) |
| F3 | P1, P2 | no caller yet | `mergeReadiness` has no production caller |
| F4 | P3 | no caller yet | `decideLocalMerge` has no production caller; `applyMergeLanding` lacks both re-checks |
| F5 | P1–P4 (claiming) | n/a | coverage record is stale after `c7875358`; properties still pass |

## Model defects found and corrected while building the skill

Each was caught by a negative control that failed to fail or by a faithful property that
failed, and is recorded so the controls are not trusted blindly:

1. `LocalLanding.tla` typed `judged` / `decided` / `landed` as records while `TypeOK`
   allowed the string `"none"`. TLA+ cannot compare a record with a string inside `\in`, so
   all four P3 configs died on `TypeOK` at state 2 without reaching the property. The
   sentinel is now the record `NoFact`.
2. `MergeGate.tla` recorded every review verdict at the current head (`vHead[!dgst] = head`),
   which made `P1H_UnboundReviewHead` pass vacuously: the review head could never differ
   from the merged head. `RecordVerdict` now chooses the recorded head freely.
3. `MergeBoundToJudgedPatch` read the verdict table at the end of the run, so a legitimate
   merge followed by a later blocking verdict on the same digest counted as a violation.
   The judging verdicts are now snapshotted into `landed` at merge time, which is what a
   verdict bound to a patch means.
4. `ExecuteMergeGithub` did not require the digest to be unchanged between evaluate and
   merge, which made the `P4_MergeRechecksDigest` control vacuous. The digest re-check is
   now an explicit constant, and whether the code does it is F1.
5. `BaseMoveInteracting` reset the stored evaluation, which also made `P4` vacuous. A base
   move does not rewrite a gate status, so the stored evaluation now survives it.

## How to reproduce

```sh
.claude/skills/verify-merge-gate/scripts/run.sh          # expect exit 0 and this table
.claude/skills/verify-step-claim/scripts/run.sh          # expect exit 0, four PASS
```

Requirements: Java 11+ and `~/.cache/cairn/tla2tools-1.7.4.jar` (SHA-256 checked by both
scripts; the download command is printed when it is missing). TLC is not run in CI.

## Repeated verdict correspondence correction

The original model at `f971a2cd` overwrote the outcome slot for a kind and digest.
The real `mergeReadiness` retains all rows and blocks if any matching verify, review or
decision row blocks. The sequence verify block, verify pass, review pass, decision pass
therefore disagreed with the model within its existing four-write bound. The real-function
probe is recorded in `repeated-verdict-runtime.json`; TLC's original counterexample is
`repeated-verdict-original-red.log`.

The current model retains verdict rows, including the independent review identity.
`P5_RepeatedVerdictRemainsBlocked` forces the same sequence using the model's public
`HasPassAt` and `HasBlockAt` operators. It passes after the correction. The eleven-config
run in `repeated-verdict-models-green.log` retains all seven original negative controls
and their original action sequences. P1 and P2 now explore 155,443 states each; their
properties and four-write bounds are unchanged. The historical logs above describe the
original model and remain preserved. The sibling claiming model was rerun unchanged; its
four properties pass in `step-claim-current-run.txt`.

All covered source files at current base `cbfbd566` are byte-identical to the original
audited `204491eb`, so the original file-and-line reachability mapping remains applicable.
The replacement changes the new skill and `docs/`, plus the same one-line `.gitignore`
allowlist entry as the original PR. Without that entry, the normal pre-commit hook
cannot re-stage this tracked skill directory. Product files are unchanged. This supporting
metadata change exceeds the issue comment's literal two-directory restriction. The owner
explicitly approved that single-line exception in chat on 2026-10-28.

## F6: the production fast-forward check and update are separate operations

At `05d0dd12`, `applyMergeLanding` reads the tip, awaits `isAncestor`
(`machine-merge-landing.ts:39`), and later awaits `updateBranchRef` (`:45`).
`apps/server/src/lib/git.ts:197` invokes `git update-ref <ref> <new>` without an
expected old value. An intervening writer can advance the default branch after the
ancestor check; the unconditional update can then overwrite that advance.

`local-landing-race.mts` exercises the actual GitOps functions against a temporary
bare repository. A candidate and a competing commit both descend from the checked
base. The initial ancestor check succeeds. The competing commit advances `main`, and
the candidate does not contain it. The following unconditional update nevertheless
succeeds and replaces it. `local-landing-race.json` records this runtime result.
The server endpoint and its scheduling were not exercised, so this establishes the
GitOps interleaving rather than the frequency of the race in deployed traffic.

The current `LocalLanding.tla` treats the fast-forward check and update as one
`LandLocal` action. Its P3 result therefore does not establish safety for this
production check/update gap. The action correspondence must be read with that
atomicity boundary. A production repair needs an expected-old-value ref update or
a synchronization mechanism that also covers other writers. This exploratory delivery
does not change product behavior. Review the in-flight local-merge work in #2050
before assigning a separate repair.

## F7: an unobserved review head was a model mistake

The unrestricted review-head choice allowed a review to name `h2` while the PR
was still at initial head `h1`. The original P1H trace therefore did not show a
reachable older-head scenario. `P6_ReviewHeadWasObserved` rejects that choice after
one review write (`future-review-head-red.log`). This is a model defect, not a
production defect.

A record now names the current head, or a previous head after an evidence-only
push preserves the patch. The current P1H counterexample is PushEvidence, three
verdicts, Evaluate, ExecuteMergeGithub: a late review names already observed `h1`
while the PR is at `h2` with the same patch. Its expectation changed to that observed
causal trace; the property and the original head, digest and four-write bounds did
not change. The seven original negative controls still fail. P1, P2 and the new P6
explore 64,329 states each, and P5 explores nine. `causal-models-green.log` records
the current twelve-config run. Historical eleven-config outputs describe the
earlier model and remain preserved.

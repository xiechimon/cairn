---
name: verify-merge-gate
description: TLA+ model checking (TLC, one command ~75 seconds) of cairn's merge gate and local landing. Use when changing mergeReadiness's verdict binding (headSha / patchDigest), the independent-review head rule, planGateStatusWrite, apiMergeGate / mergeThroughGithub (the REST merge and its `sha` pin), applyMergeLanding, or decideLocalMerge; judge whether a change makes "a merge landing on a patch no verdict judged", "a stale verdict satisfying the gate", or "a local landing without the re-checks" better or worse.
---

# verify-merge-gate

Two decisions can put code on a default branch: the gate merges a GitHub PR (`mergeThroughGithub`, a REST merge pinned to a commit) and a machine lands a local project (`landLocalMerge`, or `applyMergeLanding` for hosted projects). `mergeReadiness` and `decideLocalMerge` specify the verdict decisions. Between a decision and a landing the head can move or another verdict can arrive. Unit tests cover the orderings their author wrote; these models walk all orderings within a bounded range.

Models: `model/MergeGate.tla` (GitHub merge path), `model/LocalLanding.tla` (local landing), `model/RepeatedVerdict.tla` (repeated-verdict regression) and `model/ReviewHeadCausality.tla` (review-head causality). One configuration per property: `model/P*.cfg`. Expected results: `expected.txt`. The action-to-code correspondence lives only in this file.

Sibling skill `verify-step-claim` models who may run a step; this one models whether a result may be merged. The runner contract, the `expected.txt` format and the negative-control discipline are the same on purpose.

## When to run

Run when a change touches any file in the coverage record at the end. Copy-only or log-line changes do not need a run. When unsure, run.

```sh
.claude/skills/verify-merge-gate/scripts/run.sh                  # every config, ~75 seconds
.claude/skills/verify-merge-gate/scripts/run.sh P1_MergeBoundToJudgedPatch   # one, ~2 seconds
```

Prerequisites: Java 11+ and `~/.cache/cairn/tla2tools-1.7.4.jar`. When the jar is missing the script prints the download command and exits 2; it checks SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` (the official v1.7.4 release). Override paths with `CAIRN_TLA_JAR`, `JAVA`.

stdout is deterministic (verdicts, state counts, counterexample traces, the drift list); the work dir, timings and log paths go to stderr. Each line of `expected.txt` is a config name, its expected result and, for expected-FAIL configs, the counterexample action sequence.

Exit codes: 0 = every result and counterexample matches `expected.txt`; 1 = one changed (a new violation, a known finding no longer violating, or a counterexample that took a different path); 2 = tool or model error, including TLC reaching this config's `TypeOK` instead of its own property. At the end the script lists commits and uncommitted changes that touched covered files after `sync-commit`.

## Properties

GitHub merge path, `MergeGate.tla`:

- **P1 `MergeBoundToJudgedPatch`**: every GitHub merge landed on a patch that a verify, decision and review verdict all passed on, and, for a protected-path patch, an independent review recorded at the merged head. Broken = code lands with a green gate that never judged it.
- **P2 `StaleVerdictNeverSatisfies`**: a verdict bound to a patch other than the one evaluated never counts toward readiness.
- **P5 `RepeatedVerdictRemainsBlocked`**: a blocking verify verdict stays effective after a passing verify verdict on the same digest followed by passing review and decision verdicts.
- **P6 `ReviewHeadWasObserved`**: a review record never names a head that has not appeared. A previous head stays eligible only after an evidence-only push leaves the patch unchanged.

Local landing path, `LocalLanding.tla`:

- **P3 `LocalLandingBindsJudgedPatch`**: the base ref only moves to a patch that was judged, at the base the judgement was made against. The judgement can be redone (`Rejudge`) and the commit rebuilt (`Rebuild`) after drift, and the landing still carries the latest judgement.
- **P3E `DriftHasWayOut`**: after drift past a judgement or a built commit, a `Rejudge` or `Rebuild` is still available within the bound.

Base movement on the GitHub path: `MergeGate.tla` has an `UpdateBranch` action and a `RequireUpToDate` constant mirroring `policy.requireUpToDate` (default off in `packages/shared/src/records/project.ts`). P1 and P2 run with it on; `P1S` and `P2S` run them with it off.

## Prove the check can fail

Each negative control drops exactly the guard its property names, and its counterexample is recorded in `expected.txt`. If an expected-FAIL config starts passing, the property or the model has gone vacuous; fix that before trusting a PASS.

- `P1N` / `P2N_UnboundVerdicts`: the `patchDigest` filter is dropped. `P1H_UnboundReviewHead`: only the review-head equality is dropped.
- `P4_MergeRechecksDigest`: the digest re-check between evaluate and merge is dropped (see F1).
- `P3A_NoLandingRecheck`, `P3B_NoFfCheck`, `P3C_NoBaseRecheck`, `P3D_RebuildReusesJudgement`: a local-landing re-check, the fast-forward check, the base re-check, or the judgement binding after `Rebuild` is dropped. `P3F_NoRejudgeNoRebuild` is the model without `Rejudge` and `Rebuild`; `DriftHasWayOut` fails on it.
- `P1U` / `P2U_UnboundAfterBaseUpdate`, `P1HU_UnboundReviewHeadAfterUpdate`: the digest binding or the review-head rule is dropped with pushes disabled, so a stale verdict can only come from a base move.
- `R1` to `R6` and `P3R1` to `P3R3` are reachability witnesses, expected FAIL: each says a state is never reached and the counterexample proves it is. One turning PASS means the model lost a path it had.

## Known findings

Checked against the code on 2026-11-16. The full write-ups, including the reasoning, are in `evidence/findings.md`, a snapshot taken when each was found. Numbers follow that file; F3 and F5 are no longer true and are omitted here.

- **F1 (P4, live gap)**: `mergeThroughGithub` through `apiMergeGate` (`build-github-merge.ts`) merges with the checkpoint pin alone (`pull.headSha === checkpoint`, `sha: checkpoint`). Neither it nor `build-merge-request.ts` references `mergeReadiness` or any verdict, so the digest is not re-derived at merge time. `mergeReadiness` is called from `merge-gate-run.ts`, `local-merge-facts.ts` and `merge-gate/harness-eval-judge.ts`. Whether a stored evaluation gates this path was not re-checked. The P4 counterexample is three verdicts, `Evaluate`, `BaseMoveInteracting`, merge: the head SHA is unchanged while the diff against the default branch is not.
- **F2 (P1H, model-only)**: dropping only the review-head equality still yields a counterexample, so the head check is load-bearing on its own. In the code both conditions are one conjunction in the same filter.
- **F4 (local path, wired)**: `enqueueLocalMerge` (`local-merge.ts`) judges through `localGateFacts`; `landLocalMerge` (`apps/daemon/src/local-merge.ts`) calls `decideLocalMerge` before building the candidate and again before landing, and lands through `landGitSquash`, which updates the ref with `git update-ref --stdin`. The earlier audit recorded that the update carries the expected old value, so the fast-forward check and the update are one step; this was not re-audited.
- **F6 (hosted landing, not covered by P3)**: `applyMergeLanding` (`machine-merge-landing.ts`, hosted projects) awaits `isAncestor`, then several checks, then a separate `updateBranchRef`, so an intervening advance can be overwritten. The reproduction is `evidence/local-landing-race.json`. See F6 before using this model to accept a change to that path.
- **F7 (model mistake, kept as evidence)**: an unrestricted review-head choice made `P1H` pass vacuously; P6 and the `carriers` set fix it. The failing log is `evidence/future-review-head-red.log`, the passing one `evidence/causal-models-green.log`, and the repeated-verdict failure `evidence/repeated-verdict-original-red.log`.

## How to tell a real bug from a model mistake

Take the correspondence table below and ask, step by step, whether each counterexample step can happen from that state in the code.

- Every step maps to code and its preconditions hold: a real gap. Write it up as a finding with file and function; do not change business code unless the task says so.
- A step is impossible in the code (a precondition looser than the code, a synchronous block split in two, a check missing from the model): a model mistake. Fix the model, note what was wrong, run again.
- When unsure, write an uncommitted reproduction test and walk the real code.

## Action to code correspondence

The server is single-process with synchronous SQLite writes, so code between two `await`s cannot interleave; the model splits actions by `await` and by re-read. Function names are stable; line numbers are deliberately not recorded.

`MergeGate.tla`:

- `RecordVerdict(k, outcome, head)`: a verdict row bound to `(head, dgst)`. Write side: `persistGateVerdict` (`build-gate-verdict.ts`) binds it through `bindGateVerdict` (`merge-gate/verdict.ts`) and fills its `patchDigest` from a compare read in `builds.ts`. Read side: the `at()` filter in `mergeReadiness` keeps verdicts whose `patchDigest` equals the evaluated digest; the independent-review filter also requires `headSha === head`. Recording invalidates a stored evaluation. An earlier block is never overwritten by a later pass.
- `PushCode`: head and digest both move; earlier verdicts stay in the table but no longer match.
- `PushEvidence`: an evidence-only commit moves the head but not the digest, which is why the review-head rule needs its own binding.
- `UpdateBranch`: the PR branch takes the moved base, getting a fresh head and clearing the stored evaluation. With `RequireUpToDate` on, readiness needs the branch synced, which is the `pr-behind-base` blocker in `mergeReadiness`.
- `BaseMoveBenign` / `BaseMoveInteracting`: the default branch moves; the compare base changes, so the recomputed digest can change while the PR head stays put. A stored gate status is not rewritten by a base move.
- `Evaluate`: `mergeReadiness` computing which digests the gate accepted. Its other blockers (required checks, evidence links, the recording requirement, rounds, availability) are per-read predicates assumed satisfied. `planGateStatusWrite` (`merge-gate/gate-status.ts`) turns the result into a status on `readiness.headSha` and refuses when `checksHeadSha !== readiness.headSha`, which the model folds into `ReadyAt`.
- `ExecuteMergeGithub`: `mergeThroughGithub` with its `sha: checkpoint` pin. `MergeRechecksDigest` says whether this action also re-derives the digest; on this path the code does not (F1).

`LocalLanding.tla`:

- `JudgeLocalPatch`: the patch and base a judgement is made against, feeding `judgedBase` and `judgedPatchDigest` in the local merge facts.
- `LocalPatchChange` / `LocalBaseMove`: the patch or the default branch moves between judgement and landing.
- `CreateCommit`: the merge commit is built on whatever the base is then (`commitBase`).
- `DecideLocalMerge`: `decideLocalMerge` (`apps/daemon/src/merge-decision.ts`): a stale patch or a moved default head gives `recheck`; an unknown checkout or a dirty worktree gives `hold`; otherwise it returns the update-ref or fast-forward outcome. `RecheckPatch` and `RecheckBase` are the two guards.
- `LandLocal`: `landGitSquash` (`apps/daemon/src/git.ts`). The landed fact is the commit's own base and patch, not the current ones. For hosted projects see F6.
- `Rejudge`: a new judgement on the current patch and base after a `recheck`; the next `enqueueLocalMerge` reads fresh facts.
- `Rebuild`: the commit is built again on the current base; `landLocalMerge` builds the candidate with `commit-tree` on the command's `judgedBase`, so a rebuilt commit comes with a new command.
- `RebuildRefreshesChecks`: the broken variant used by `P3D`, where the re-checks compare against the rebuilt commit instead of the judgement.

## Bounds and assumptions

- Three heads, two digests, two bases. GitHub path: at most one push (code or evidence), one base move, one `UpdateBranch`, `MaxVerdicts` verdict records. Local path: one patch change, one base move, `MaxRejudges` (2) `Rejudge` and `Rebuild`, one landing. Pass means all orderings within these bounds satisfy the properties, not that the whole system is correct.
- Assumed satisfied and outside the model: required checks, `pr-evidence`, mergeable state, size caps, evidence links, the recording requirement, round limits, availability. `base-not-default` is not modelled.
- Digest assumption, not checked against the code: the model lets an interacting base move change the patch digest. The code reads `compare/${base}...${head}` (three dots, `lib/github.ts`), which diffs the head against the merge base, so a default-branch move that does not touch the PR's files leaves the digest unchanged even when it changes the merged result. If so, the only guard is `requireUpToDate` (off by default) and the checks. Left for the owner as a design question.
- A review verdict names a head from `carriers` (heads whose patch equals the current digest). Identical verdict rows collapse in the set; a pass and a block on one kind and digest coexist, and any block keeps that kind blocked.
- `LandLocal` treats the fast-forward check and the ref update as atomic; that holds for `landGitSquash` but not for hosted `applyMergeLanding` (F6).
- Dirty-worktree and unknown-checkout holds are not modelled; they end an attempt without landing, which no property forbids.
- Everything is fail-closed: an unreadable input blocks. The model only explores readable inputs, so it cannot show a fail-open path.

Not in scope: scheduler and chief wiring, the CI green-wash loop, `unstable` mergeable-state handling, cross-repo and fork PRs, liveness, the daemon's merge step itself, and the force-push case (covered within the bounds by `PushCode`).

## After a code change

1. Run `run.sh` and read every commit it lists after `sync-commit`.
2. Judge each one: no effect on the model, the model must follow, the promise intentionally changed (needs a commit note, test or doc as evidence), or the promise may break.
3. Change the model per the code, not per the result. One synchronous code block stays one model action.
4. Change a property only when the promise intentionally changed, and write the old wording, the new wording and the evidence here. Never weaken a property or a bound to make it pass.
5. Re-run. A FAIL turning PASS needs two confirmations first: the code really fixed it, and redoing the breaking action makes the model report it again. Then update `expected.txt` and move `sync-commit` to the audited commit.

## Coverage record

```coverage
  apps/server/src/services/merge-gate/readiness.ts
  apps/server/src/services/merge-gate/gate-status.ts
  apps/server/src/services/merge-gate/digest.ts
  apps/server/src/services/merge-gate/verdict.ts
  apps/server/src/services/merge-gate/github-facts.ts
  apps/server/src/services/merge-gate/github-port.ts
  apps/server/src/services/merge-gate/paths.ts
  apps/server/src/services/merge-gate/evidence-link.ts
  apps/server/src/services/merge-gate/model-identity.ts
  apps/server/src/services/merge-gate/model-roster.ts
  apps/server/src/services/merge-gate/model-roster-data.ts
  apps/server/src/services/merge-gate-github.ts
  apps/server/src/services/builds.ts
  apps/server/src/services/build-github-merge.ts
  apps/server/src/services/build-merge-request.ts
  apps/server/src/services/build-step-state.ts
  apps/server/src/lib/git.ts
  apps/server/src/services/machine-merge-landing.ts
  apps/server/src/services/machine-finish-step.ts
  apps/server/src/services/local-merge.ts
  apps/server/src/services/local-merge-facts.ts
  apps/server/src/services/merge-gate-run.ts
  apps/server/src/lib/github.ts
  packages/shared/src/records/project.ts
  apps/daemon/src/merge-decision.ts
  apps/daemon/src/local-merge.ts
  apps/daemon/src/git.ts
```

sync-commit: cbfbd566acd375fd924b00ba02e8075435fbe9df

---
name: verify-merge-gate
description: TLA+ model checking (TLC, one command ~75 seconds) of cairn's merge gate and local landing. Use when changing mergeReadiness's verdict binding (headSha / patchDigest), the independent-review head rule, planGateStatusWrite, apiMergeGate / mergeThroughGithub (the REST merge and its `sha` pin), applyMergeLanding, or decideLocalMerge; judge whether a change makes "a merge landing on a patch no verdict judged", "a stale verdict satisfying the gate", or "a local landing without the re-checks" better or worse.
---

# verify-merge-gate

Two decisions can put code on a default branch: the gate merges a GitHub PR (`mergeThroughGithub`, REST merge pinned to a commit) and a machine lands a hosted local project (`applyMergeLanding`, a ref update). `mergeReadiness` and `decideLocalMerge` specify the verdict decisions; their production wiring boundaries are F1, F3 and F4 below. Between a decision and a landing the head can move or another verdict can arrive. Unit tests cover the orderings their author wrote; these models walk **all** orderings within a bounded range.

Models: `model/MergeGate.tla` (the GitHub merge path), `model/LocalLanding.tla` (the local landing path) and `model/RepeatedVerdict.tla` (the repeated-verdict regression) and `model/ReviewHeadCausality.tla` (review-head causality), comment-free; the action-to-code correspondence lives only in this file. One configuration per property: `model/P*.cfg`. Expected results: `expected.txt`.

Sibling skill: `verify-step-claim` models who may run a step; this one models whether a result may be merged. The runner contract, the `expected.txt` format and the negative-control discipline are the same on purpose.

## When to run

Run when a change touches any file in the coverage record below. Copy-only or log-line changes do not need a run. When unsure, run.

## How to run

```sh
.claude/skills/verify-merge-gate/scripts/run.sh                  # all twenty-nine configs, ~75 seconds
.claude/skills/verify-merge-gate/scripts/run.sh P1_MergeBoundToJudgedPatch   # one, ~2 seconds
```

Prerequisites: Java 11+ and `~/.cache/cairn/tla2tools-1.7.4.jar`. When the jar is missing the script prints the download command and exits 2; it checks SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` (the official v1.7.4 release). Override paths with `CAIRN_TLA_JAR`, `JAVA`. TLC intermediates stay under `$TMPDIR/verify-merge-gate.*` and are removed on exit.

stdout is deterministic — verdicts, state counts, counterexample traces, the drift list — so a captured evidence file reproduces byte for byte on a fresh run. The work dir, per-config timings and log paths go to stderr.

Each line of `expected.txt` is config name, expected result, and for expected-FAIL configs the counterexample action sequence. Expected-FAIL configs run single-threaded, so the counterexample is deterministic.

Exit codes:
- 0 = every result matches `expected.txt`, and every expected-FAIL counterexample action sequence matches.
- 1 = one changed: a new violation, a known finding no longer violating, or a known finding's counterexample took a different path (a shorter path or a blocked old path is also a change).
- 2 = tool or model error, including TLC reaching this config's `TypeOK` instead of its own property.

At the end the script lists commits and uncommitted changes that touched covered files after `sync-commit`.

## Properties

The GitHub merge path, `MergeGate.tla`:

- **P1 `MergeBoundToJudgedPatch`**: every GitHub merge landed on a patch that a verify, decision and review verdict all passed on, and, for a protected-path patch, an independent review recorded at the merged head. Broken = code lands with a green gate that never judged it.
- **P6 `ReviewHeadWasObserved`**: review records cannot refer to a head that has not appeared. A previous head remains eligible only after an evidence-only push keeps the patch unchanged.
- **P5 `RepeatedVerdictRemainsBlocked`**: a blocking verify verdict remains effective after a passing verify verdict on the same digest, followed by passing review and decision verdicts. This forced four-write sequence is checked against `mergeReadiness` retaining any blocking row.
- **P2 `StaleVerdictNeverSatisfies`**: a verdict bound to a patch other than the one evaluated never counts toward readiness. Broken = a verdict on an old patch qualifies a new one.

The local landing path, `LocalLanding.tla`:

- **P3 `LocalLandingBindsJudgedPatch`**: the base ref only moves to a patch that was judged, at the base the judgement was made against. Broken = the default branch takes a patch nobody reviewed, or a patch reviewed against a different base. Since #2526 it holds over multi-attempt behaviours: the judgement can be redone (`Rejudge`) and the commit rebuilt (`Rebuild`) after drift, and the landing still carries the latest judgement.
- **P3E `DriftHasWayOut`**: after the patch or base drifts past a judgement or a built commit, a `Rejudge` or `Rebuild` is still available within the bound (`MaxRejudges = 2`, one patch change and one base move can each happen once). The model before #2526 had no such step; `P3F` is that model and TLC reports the dead end after `JudgeLocalPatch,LocalPatchChange`.

Base movement on the GitHub path (#2525). `MergeGate.tla` has an `UpdateBranch` action (the PR branch takes the moved base, new head, stored evaluation cleared) and a `RequireUpToDate` constant mirroring `policy.requireUpToDate` (`readiness.ts:339`, default off in `packages/shared/src/records/project.ts:81`). P1 and P2 run with it on (a PR behind its base is not ready until `UpdateBranch`) and `P1S`/`P2S` run them with it off (ready on the moved base without an update). The `R*` configs are reachability witnesses, expected FAIL: each says "this state is never reached" and TLC's counterexample proves it is reached.

## Prior art

Searched for open TLA+ models of merge queues and CI gating. Found two, and neither models base movement:

- Mergify, "How we formally verified our merge queue with TLA+" (https://mergify.com/blog/how-we-formally-verified-our-merge-queue-with-tla-plus): train, cars and PR sets with batching, freezing and speculative CI; git and GitHub IO left out; 468,000 states, two bugs. Borrowed: (1) their bug 1 is a condition that changed between "CI passed" and "merge" and was fixed by guarding the consuming merge actions, not the transition, which is the P4 shape and why `ExecuteMergeGithub` carries the `MergeRechecksDigest` guard; (2) two of their invariants were vacuously true because they named a state the model never reaches, which is the failure #2525 reported for `ReadyAt`, so every new path here has an `R*` reachability witness that must FAIL.
- Aviator, "Modeling a merge queue with TLA+" (https://www.aviator.co/blog/?p=1702, tutorial): PRs, CI and a merge actor with a `PriorPRMerged` ordering guard; no base variable and no re-test. Nothing borrowed beyond the ordering-as-guard idea.
- `tlaplus/Examples` (checked by listing `specifications/` and a code search for merge queue, rebase): no merge-queue or CI-gating spec. Bors and Homu have no published TLA+ model that the search found.

So base movement and re-judgement are modelled from cairn's code here, not from a published model.

## Current results and known findings (at sync-commit)

29 configs, ~75 seconds (was 12 configs, ~15 seconds). `P1 PASS` and `P2 PASS` (177,706 distinct states each), `P1S PASS` and `P2S PASS` (177,978), `P3 PASS` (167 states), `P3E PASS` (167), `P5 PASS` (9 states), `P6 PASS` (177,706). Before #2525/#2526: P1/P2/P6 64,329 states, P3 47. The control constants select the negative controls; P1N, P2N, P1H, P4, P2U, P1U, P1HU, P3A, P3B, P3C, P3D and P3F are expected-FAIL, as are the witnesses R1-R6 and P3R1-P3R3.

**F1 (P4, live gap) the REST merge path consults no verdict and no digest.**
The merge that runs today is `mergeThroughGithub` (`builds.ts:1512`) through `apiMergeGate` (`builds.ts:1453`): the card's phase and latest build, no step in flight, then the PR's state, branch, author and base ref, then the checkpoint pin — `builds.ts:1603` reads the checkpoint, `builds.ts:1610` requires `pull.headSha === checkpoint`, `builds.ts:1618` merges with `sha: checkpoint`. Verdicts with digests do exist by then: `persistGateVerdict` (`build-gate-verdict.ts`) binds every review/verify verdict to a head through `bindGateVerdict` (`verdict.ts:27`) and fills its `patchDigest` from a compare read (`builds.ts:1422`, stored at `:1439`), and `mergeReadiness` (`readiness.ts:156`) accepts only verdicts bound to the digest it just computed (`readiness.ts:434`). The merge path reads none of that: no `mergeReadiness` call and no verdict query anywhere in it. The model states the missing re-check as `MergeRechecksDigest = FALSE` (config `P4_MergeRechecksDigest`), and TLC's counterexample is three verdicts, `Evaluate`, `BaseMoveInteracting`, merge: the head SHA is unchanged while the diff against the default branch is not.

Reachability, precisely. The gap is live: this path merges PRs today, and it does so without reading any verdict or digest, so the property P4 names is not enforced here at all — that is the finding. The counterexample trace itself cannot fire end-to-end today, because its `Evaluate` step has no counterpart on the path: nothing evaluates the gate there (F3), so no evaluation, stale or fresh, authorises or blocks this merge. The trace is the hazard the wiring must not reproduce. Open PR #1821 (server(#1794)) adds the gate's first caller — `merge-gate-run.ts` `evaluateMergeGate`, recording `gate_digest` per build — without touching `mergeThroughGithub`; the moment a stored evaluation starts gating this path, a merge that trusts it without re-deriving the digest at merge time lands exactly the P4 trace. Recorded as a finding, not fixed here: this PR adds no product code.

**F2 (P1H, model-only) the review-head rule is the binding that matters on a force-push-free path.**
Dropping only `v.headSha === head` (`readiness.ts:335`) and keeping the digest binding (`readiness.ts:337`, the general `at()` filter at `:434`) still yields a counterexample (config `P1H_UnboundReviewHead`): choose an older head for the review verdict. In the real code both conditions are one conjunction in the same filter, so this control demonstrates that the head check is load-bearing on its own, not that the code is missing it.

**F3 (reachability boundary) `mergeReadiness` has no production caller.**
At sync-commit its only non-test references are its own definition (`readiness.ts:156`), the shared schema (`packages/shared/src/records/merge-gate.ts:326`) and test fixtures; no product code calls it, so P1 and P2 describe a function whose result nothing acts on yet. Open PR #1821 (server(#1794)) adds the first caller: `merge-gate-run.ts` `evaluateMergeGate`, run from the ci-loop sweep, records `gate_digest` / `gate_round` / `gate_state` per PR build. That PR does not touch `mergeThroughGithub`, so the REST merge still runs on the checkpoint pin alone. Re-run this skill when a caller lands, and settle F1's re-check question before making the merge path trust a stored evaluation.

**F4 (P3 boundary) `decideLocalMerge` has no production caller either.**
`decideLocalMerge` (`merge-decision.ts:17`) is referenced only by `apps/daemon/test/merge-decision.test.ts`; `judgedBase` / `judgedPatchDigest` appear nowhere else (`merge-decision.ts:6`, `:8`). The production local landing is `applyMergeLanding` (`machine-merge-landing.ts:20`), called from `machine-finish-step.ts:264`, and it re-checks only that the new tip is a fast-forward (`machine-merge-landing.ts:39`) before updating the ref (`:45`). So the model's P3 holds for the function `decideLocalMerge` defines, and the wiring that would make the two re-checks run has not landed. Open PR #2050 (daemon+server(#1625), gated local squash merges) is that wiring: it touches `merge-decision.ts`, `machine-finish-step.ts` and adds `local-merge.ts` on both sides. Re-run this skill when it lands and check where its re-checks sit relative to the landing.

*Update at #2526 (read, not re-audited commit by commit):* the wiring has landed. `enqueueLocalMerge` (`apps/server/src/services/local-merge.ts:22`) judges through `localGateFacts` and issues a command with `judgedBase`, `judgedHead` and `judgedPatchDigest`; `landLocalMerge` (`apps/daemon/src/local-merge.ts`) calls `decideLocalMerge` before building the candidate (`:133`) and again just before landing (`:171`), builds the commit on `judgedBase` with `commit-tree` (`:152`), and lands through `landGitSquash` (`apps/daemon/src/git.ts:216`), whose `update-ref` carries the expected old value `base` (`:268`) so the fast-forward check and the ref update are one compare-and-swap. A `recheck` outcome reaches `applyLocalMergeReport` (`:94`), which wakes the chief (`:149`); the next `enqueueLocalMerge` is the `Rejudge` and `Rebuild` the model now has. So on this path `LandLocal` is atomic in the code as in the model. The server's `applyMergeLanding` (`machine-merge-landing.ts:20`, hosted projects) is a different path: it still ends in an `isAncestor` read and a separate `updateBranchRef` (`:39`, `:45`), so F6 stands for it and the model does not cover it.

**F5 (task claiming, sibling skill) `tryClaim` moved out of the covered set.**
The `verify-step-claim` coverage record lists `apps/server/src/services/machines.ts`, but `tryClaim` and `claimStep` now live in `apps/server/src/services/machine-claim.ts`, created by the module split `c7875358 server(1522)` (the CAS moved verbatim: worker `machines.ts:1090-1092` -> `machine-claim.ts:343-345`, chief `machines.ts:845-847` -> `machine-claim.ts:170-172`). The claim CAS is therefore no longer in a file that skill's drift check reads. Its four properties still PASS at this HEAD (685,236 distinct states each); the commit-by-commit audit behind that call is `docs/verify/1811/findings.md` F5, which covers every commit since that skill's sync-commit `93b9ce21` that touched the claim, finish and landing machinery — the newest, `529efdc6` (chief digest candidates), included, with the CAS itself unchanged. The coverage record needs `machine-claim.ts`, `machine-finish-step.ts` and `machine-merge-landing.ts` added. Recorded here rather than edited there, so this PR keeps its diff to the new skill and docs.

## How to tell a real bug from a model mistake

Take the action correspondence table below and ask step by step whether each counterexample step can happen from that state in the code.

- Every step maps to code and its preconditions hold → real gap. Write it up as a finding with file:line; do not change business code unless the task says so.
- A step is impossible in the code (precondition looser than the code, one code-side synchronous block split into two, a code-side check missing from the model) → model mistake. Fix the model, note what was wrong, run again.
- When unsure, write an uncommitted reproduction test and walk the real code.

The model's own defects found while building this skill, kept as evidence that the negative controls are not vacuous: `LocalLanding.tla` first typed `judged`/`decided`/`landed` as records while `TypeOK` allowed the string `"none"`, so all four P3 configs died on `TypeOK` at state 2 and never reached the property; the sentinel is now the record `NoFact`. `MergeGate.tla` first recorded every review verdict at the current head (`vHead[!dgst] = head`), which made `P1H_UnboundReviewHead` pass vacuously; the current model chooses the current head or, after an evidence-only push, the previous head carrying the same patch. P6 rejects the original unrestricted choice because it admitted a head before that head existed. `MergeBoundToJudgedPatch` first read the verdicts at the end of the run, so a legitimate merge followed by a later blocking verdict counted as a violation; the judging verdicts are now snapshotted into `landed` at merge time.

## Action ↔ code correspondence

Line numbers are at sync-commit `cbfbd566`; covered source files are unchanged from the original audit at `204491eb`. The server is single-process with synchronous SQLite writes, so code between two `await`s cannot interleave; the model splits actions by `await` and by re-read.

`MergeGate.tla`:

- `RecordVerdict(k, outcome, head)` — a verdict row bound to `(head, dgst)`. Write side: `persistGateVerdict` (`build-gate-verdict.ts`) inserts the row through `bindGateVerdict` (`verdict.ts:27`) with `patchDigest` null, then fills it from a compare read (`builds.ts:1422`, stored at `:1439`). Read side: `readiness.ts:434` `at()` filters by `patchDigest === D`; the independent-review filter additionally requires `v.headSha === head` (`readiness.ts:335`, digest half at `:337`). Recording invalidates a stored evaluation, because `mergeReadiness` recomputes from the whole verdict set on every call. The model retains a set of rows with kind, digest, outcome and review identity; an earlier block cannot be overwritten by a later pass.
- `PushCode` — a new commit on the PR branch: head and digest both move, all earlier verdicts stay in the table but no longer match.
- `PushEvidence` — an evidence-only commit: the head moves, the digest does not, which is why the review-head rule needs its own binding.
- `UpdateBranch` (#2525) — the PR branch takes the moved base (GitHub "update branch", a merge or rebase of the default branch into the PR head): a fresh head, the stored evaluation cleared, the branch counted as synced. The digest is not touched here: an interacting base move already changed it at `BaseMoveInteracting`, and a benign one never did, so after the update the digest is the one the compare read returns against the new base. `Synced` is derived (`base = "b1" \/ updates = 1`); with `RequireUpToDate` on, `ReadyAt` needs it, which is the `pr-behind-base` blocker (`readiness.ts:339`); with it off, `ReadyAt` ignores it. Heads are `h1`..`h3` and each move takes a fresh one (`FreshHead`); `used` is every head that has appeared and `carriers` is the heads whose patch equals the current digest, which is the set a review verdict may name (`RecordVerdict`), so a head never appears before it exists (P6 is now `recordedHead \in used`).
- `BaseMoveBenign` / `BaseMoveInteracting` — the default branch moves; the compare base changes, so the patch digest recomputed against it can change while the PR head stays put. Benign keeps the digest, interacting changes it. A stored gate status is not rewritten by a base move, so the model keeps `lastEval` here.
- `Evaluate` — `mergeReadiness` (`readiness.ts:156`) writing `satVerify` / `satDecision` / `satReview` / `satReviewHead`: the digests the gate accepted. Its other blockers — required checks, evidence links, the recording requirement (`readiness.ts:406`), rounds, availability — are per-read predicates assumed satisfied, see Bounds. `planGateStatusWrite` (`gate-status.ts:43`) is the step that turns this into a status on `readiness.headSha`; it refuses when `checksHeadSha !== readiness.headSha`, which the model folds into `ReadyAt`.
- `ExecuteMergeGithub` — `mergeThroughGithub` (`builds.ts:1512`) and its `sha: checkpoint` pin at `builds.ts:1618`, guarded by `pull.headSha === checkpoint` at `builds.ts:1610`. `MergeRechecksDigest` is the constant that says whether this action also re-derives the digest; on this path the code neither re-derives a digest nor reads any verdict (F1).

`LocalLanding.tla`:

- `JudgeLocalPatch` — the patch and base a judgement is made against, feeding `LocalMergeFacts.judgedBase` / `judgedPatchDigest` (`merge-decision.ts:6-8`).
- `LocalPatchChange` / `LocalBaseMove` — the patch or the default branch moves between judgement and landing.
- `CreateCommit` — the merge commit is built on whatever the base is at that moment (`commitBase`).
- `DecideLocalMerge` — `decideLocalMerge` (`merge-decision.ts:17`): patch stale → recheck (`:18`), default head moved → recheck (`:21`), checkout unknown → hold (`:23`), worktree dirty → hold (`:26`), otherwise update-ref (`:25`) or fast-forward (`:27`). `RecheckPatch` / `RecheckBase` are those two guards.
- `LandLocal` — `landGitSquash` (`apps/daemon/src/git.ts:216`): the ref update carries the expected old value (`:268`), so `FfCheck` (`base = commitBase`) and the update are one step. The landed fact is the commit's own base and patch (`commitBase`, `commitPatch`), not the current ones. For the hosted-project path `applyMergeLanding` (`machine-merge-landing.ts:20`) see F4 and F6.
- `Rejudge` (#2526) — a new judgement on the current patch and base after a `recheck`; it voids a standing decision. Code: the next `enqueueLocalMerge` (`apps/server/src/services/local-merge.ts:22`) reads fresh `judgedBase` / `judgedPatchDigest` through `localGateFacts`.
- `Rebuild` (#2526) — the commit is built again on the current base and patch and the standing decision is voided. Code: `landLocalMerge` builds the candidate with `commit-tree` on the command's `judgedBase` (`apps/daemon/src/local-merge.ts:152`), so a rebuilt commit comes with a new command; the model lets the two happen in either order and requires `DecideLocalMerge` to see both agree with the same judgement.
- `RebuildRefreshesChecks` — the broken variant of `DecideLocalMerge`: once a `Rebuild` has happened, the re-checks compare against the rebuilt commit instead of the judgement (P3D).

## Bounds and assumptions

- Three heads, two digests, two bases. On the GitHub path: at most one push (code or evidence, not both), one base move (benign or interacting), one `UpdateBranch`, at most `MaxVerdicts` verdict records. On the local path: one patch change, one base move, at most `MaxRejudges` (2) `Rejudge` and `Rebuild`, one landing. Orderings beyond these are not checked. Pass = all orderings within these bounds satisfy the properties, not that the whole system is correct.
- The gate's other inputs (required checks, `pr-evidence`, mergeable state, size caps, evidence links, the `recording-missing` recording requirement at `readiness.ts:406`, the round limits, availability) are assumed satisfied: they are per-read predicates with no read-to-act gap, so they do not enter the model. With `RequireUpToDate` on, `ReadyAt` requires the branch to be synced with the moved base (the `pr-behind-base` blocker); `base-not-default` is not modelled.
- Digest assumption, not checked against the code. The model lets an interacting base move change the patch digest (`BaseMoveInteracting`). The code reads the compare as `compare/${base}...${head}` (`apps/server/src/lib/github.ts:1758`, three dots), and digests the files of that compare (`digest.ts`). Inference, not run here: a three-dot compare diffs the head against the merge base, so a default-branch move that does not touch the PR's files leaves the digest unchanged even when it changes the merged result. If so, the only guard against a verdict judged before such a move is `requireUpToDate` (off by default) and the checks, and P2U/P1U model what happens only when the digest does move. Left for the owner as a design question; this PR changes no code.
- A review verdict names a head from `carriers` (heads whose patch equals the current digest); a verdict row's head is not otherwise constrained.
- `PlanGateStatusWrite` is modelled only through `checksHeadSha === readiness.headSha`; the write itself is a GitHub side effect with no effect on the decision.
- Up to `MaxVerdicts` writes retain all verdict records. Identical rows collapse in the set because duplicate rows do not change existential pass/block queries, while the write counter still advances. A pass and a block on the same kind and digest coexist. Any block keeps that kind blocked; an earlier qualifying independent review remains available after another review is recorded.
- `LandLocal` treats its fast-forward check and ref update atomically. `landGitSquash` does that with a compare-and-swap `update-ref` (F4 update). The hosted-project `applyMergeLanding` awaits `isAncestor` and `updateBranchRef` separately with an unconditional update; the real GitOps reproduction in `docs/verify/1811/local-landing-race.json` demonstrates an intervening advance can be overwritten there. P3 does not cover that path. See findings F6 before using this model to accept a change to it.
- Dirty-worktree and unknown-checkout holds (`decideLocalMerge` `hold` outcomes) are not modelled; they end an attempt without landing, which no property here forbids.
- Everything is fail-closed: an unreadable input blocks. The model only explores inputs that are readable, so it cannot show a fail-open path that needs an unreadable input.

**Not in scope**: the scheduler and chief wiring (no production caller yet, F3/F4); the CI green-wash loop; `unstable` mergeable-state handling; the `harness-regression-*` blockers; cross-repo or fork PRs; liveness ("the gate eventually reaches a decision"); the daemon's merge step itself (`runner.ts` merge session); the force-push case, where `v.headSha === head` also has to catch a rewritten head, which within these bounds is covered by `PushCode`.

## Update verification (after a code change)

1. Run `run.sh`, record the result. Read every commit the end lists after `sync-commit`.
2. Judge each change: does not affect the model / the model must follow / the promise intentionally changed (needs a commit note, test, or doc as evidence) / may break the promise.
3. Change the model per the code, not per the result. One code synchronous block stays one model action.
4. Only change a property when the promise intentionally changed: write the old wording, the new wording and the evidence here. Do not weaken a property or a bound to make it pass.
5. Re-run. FAIL → PASS must first confirm the code really fixed it, then redo the breaking action and confirm the model reports it again; then update `expected.txt`.
6. Push `sync-commit` below to the audited commit and update "current results and known findings".

## Prove the check can fail (done once, and on every model change)

Each control drops exactly the guard its property names, and the counterexample is recorded in `expected.txt`:

- `P1N_UnboundVerdicts` / `P2N_UnboundVerdicts`: `BindingBound = FALSE` drops the `patchDigest === D` filter, mirroring pre-D3 code. Both properties report a violation: a verdict recorded on `d1`, then a code push to `d2`, then three verdicts, then evaluate and merge.
- `P1H_UnboundReviewHead`: `ReviewHeadBound = FALSE` drops only the review-head equality.
- `P4_MergeRechecksDigest`: `MergeRechecksDigest = FALSE` drops the digest re-check between evaluate and merge. The live merge path (`builds.ts`) has neither the re-check nor the evaluation; what that does and does not mean today is F1.
- `P3A_NoLandingRecheck`: both re-checks off. `P3B_NoFfCheck`: no fast-forward check. `P3C_NoBaseRecheck`: base re-check off, patch re-check on.
- `P2U_UnboundAfterBaseUpdate` / `P1U_UnboundAfterBaseUpdate` (#2525): the digest binding off, pushes disabled, so the stale verdict can only come from a base move: a verdict on `d1`, `BaseMoveInteracting`, `UpdateBranch`, two fresh verdicts, `Evaluate` (and the merge for P1U). `P1HU_UnboundReviewHeadAfterUpdate`: the review-head rule off, a protected patch, a benign base move and `UpdateBranch` moving the head past an independent review recorded at the old one.
- `R1`-`R6` (#2525) and `P3R1`-`P3R3` (#2526) are not controls but reachability witnesses: each invariant forbids a state the real spec must reach (ready on the moved base, ready on the interacting digest after an update, ready on the benign digest, a protected patch ready on the updated head, a merge after the update, ready on the moved base with `RequireUpToDate` off; a landing after `Rejudge`, after `Rebuild`, after both drifts). They are expected FAIL; one turning PASS means the model lost a path it had.
- `P3D_RebuildReusesJudgement` (#2526): after `Rebuild` the re-checks compare against the rebuilt commit, so the first judgement lands a patch it never covered: `JudgeLocalPatch,CreateCommit,LocalPatchChange,Rebuild,DecideLocalMerge,LandLocal`. `P3F_NoRejudgeNoRebuild`: `MaxRejudges = 0` is the model before #2526, and `DriftHasWayOut` fails right after the first drift.

The first draft of this extension was mutation-checked: replacing `rh \in carriers` by `rh \in Heads` in `RecordVerdict` makes P6 fail (a review recorded at a head that has not appeared), so the generalised P6 still catches what the original did.

If any expected-FAIL control starts passing, the property or the model has gone vacuous; fix that before trusting a PASS.

The original single-slot model failed P5: verify block, verify pass, review pass, decision pass, evaluate. TLC reported readiness after the block was overwritten. The row-set model passes the same regression without changing `MaxVerdicts` or the original properties; the original seven controls still produce their recorded counterexamples. See `docs/verify/1811/repeated-verdict-original-red.log` and `repeated-verdict-models-green.log`.

The original unrestricted review-head choice also failed P6 after one review write. Its original failure is `docs/verify/1811/future-review-head-red.log`. The causal-head correction leaves the existing bounds unchanged and makes P1H demonstrate an older, already observed head instead. The current twelve-config output is `docs/verify/1811/causal-models-green.log`.

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

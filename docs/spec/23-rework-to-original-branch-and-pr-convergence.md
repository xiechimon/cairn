# 23 · Rework back to the original branch and PR convergence (issue #931)

> Canonical policy: the ruling, mechanism and legacy-data convergence rules for rework (review-gate rejection + failure restart with feedback) landing back on the original branch / original PR. The ticket of record = issue #931; implementation deviations must be folded back into this document.

## 1. Facts (measured, not inferred)

- buildId ≡ conversationId ≡ branch name (`brand.ts conversationBranch`, `pacman/conv-<uuid>`, schema.ts build table header note) — **a new build necessarily means a new branch**, which is the structural root cause of "rework opens a separate PR", not some missing line somewhere.
- The two rework paths previously had different sources: `revision` (#701) re-queues a replanning step under the same build (branch naturally kept); `restart` (#320/#720) `newUuidv7()` starts a fresh build → the branch is thrown away. Ticket scene: todo `q5ULhY_3exxQPatM4ZkFm` had the same change open as both PR #888 and #928.
- PR fields (build.prUrl/prNumber) are only probed and backfilled at daemon step finish for github-shape projects (`runner.ts` prProbe → `finishStep`); hosted/local projects are always empty.

## 2. Ruling (user, 2026-10-05)

- **R1: for a task with a PR, any rework goes back to the original branch.** Both paths count — review-gate rejection and failure restart with feedback — rework lands on "the newest build at that moment that has produced a PR": same conversationId = same branch = the original PR receives new commits in place. **One todo has at most one open PR at any moment.**
- **R2: only the branch is reused; the session is brand new.** The first step of a reuse round forces a fresh engine session (step.freshSession → claim `session.action='new'`); the daemon opens a brand-new session with the combined string of "full task text + rework instruction" (#720 form); the workspace is rolled back to the branch's committed state (uncommitted residue from the previous failed round is not carried over). Branch continuity and session vacuum are two dimensions; both are executed per the ruling, without quietly picking one.
- **R3: a new branch is allowed only when the original PR is already merged/closed, and the ruling is visible.** At restart time the server probes PR state once (github_connection token → anonymous fallback); closed → new build + new conv lands a system note (`buildReworkNewBranchNote`) naming the old PR and the new branch name — the user can see "why this one is a new PR". **Probe failure = fail-open reuse**: wrongly opening a new branch brings back R1's bug as is, while wrongly reusing a merged branch only lands commits on the old branch (visible, cleanable) — the costs are asymmetric.
- **R4: ordinary restart of a build without a PR is unchanged.** No PR fields → the current new-build/new-conv behavior stays byte for byte (`startBuilds` family semantics: fresh execution).

## 3. Mechanism (server-side ruling + daemon-side consumption)

- **Ruling point** = the restart branch of `builds.ts applyBuildStepAction`: `latestPrBuild` (the newest build of the todo whose prUrl/prNumber is non-empty, createdAt descending) → `probeReworkTargetPr` → the reuse path (no new build; a feedback line + `buildReworkReuseNote` lands in the old conv, the latter carrying the original failure text of the cleared build.errorMessage; the first step sets freshSession; the build row's errorMessage cleared / prevPhase='failed' / pin falls back to todo.machineId) or the new-build path (current behavior + the ruling note when prClosed is set).
- **Claim surface** (`machines.ts tryClaim`): a freshSession step gets `session={action:'new', sessionId:null}` and does not enter the #863 session-affinity gate (a new session has no session-file dependency; do not hold the step for another machine). The reuse round's later steps (post-confirm execution steps, rejection-replanning steps) continue that round's newly opened session as usual — the review-reject path and the restart path are same-source from here on.
- **Daemon surface** (`runner.ts`): fresh session + reused worktree → `restoreCheckpoint` rolls back to the branch head (canon line "rework new session: workspace rolls back to the branch head"); the form where the worktree has already been orphan-reclaimed (TTL 7d) makes `prepare` rebuild from origin/<branch> anyway (existing guardrail in 02 §5.5) — "old build already finished, workspace already reclaimed" is not a reason to start another branch.
- **Plan version**: on a reused build, `receivePlanUpload` version=max+1 naturally yields v2/v3; the diff surface has zero changes.

## 4. Legacy-data convergence rules (existing data with multiple open PRs per todo)

- Rework always lands on the **newest** build that has produced a PR (`latestPrBuild`); older PR builds belong to superseded branches — they no longer enter rounds and are not auto-closed. pacman **does not close GitHub PRs on the user's behalf** (an outward write operation, with no precedent on this site) — older open PRs are closed by the user by hand (#931's incident scene #888 was handled this way).
- The mechanism guarantees new data does not keep doubling: once the reuse path converges to a single build, later rework still hits the same PR build; the branch count does not grow with the number of reworks.
- `latestBuildId` under the legacy form (newest failed build without a PR, PR build older) points back to the PR build — the truth of "which conv the current round runs in" takes priority over monotonic recency; the form does not appear in new data after the fix (reuse keeps the PR build always newest).

## 5. Boundaries (entry points this ruling does not cover — rerun ≠ rework)

- The three `startBuilds` entries (REST manual start, chief `run_builds`, scheduled rerun) still create a new build and a new branch: rerun semantics = fresh execution, not rework. If users also want the original branch from these entries, open a separate ticket for a ruling (it involves the semantic fork of "fresh execution vs continuation", and does not fold into this ticket).
- hosted/local projects have no PR probing surface, PR fields are always empty → R1's condition never triggers; rework behavior is identical to the status quo (new conv).
- Review steps always use a new session (#511); they share the "force new session" criterion family with this mechanism but each stays on its own surface (review's read-only guardrail is unaffected by the reuse path).

## 6. Verification anchors

- Server surface: `apps/server/test/rework-branch-reuse.test.ts` (failure modes 1-10).
- Integration E2E: `integration/test/rework-branch-reuse-e2e.test.ts` (both rework paths: same conv / same branch / new commits land on the original branch / session-form reconciliation).
- Regression pins: `m7-failed-send-e2e` (R4 no-PR path kept byte for byte), `machine-pin.test.ts` (pin fallback), `machine-session-affinity.test.ts` (affinity gate does not regress).
- Evidence: `docs/verify/931/` (committed with the PR, referenced by permanent SHA links).

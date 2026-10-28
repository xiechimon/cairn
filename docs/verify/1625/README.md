# Local merge executor acceptance

## Scope and policy

This implements segment 3 from the [owner's acceptance checklist](https://github.com/xiechimon/cairn/issues/1625#issuecomment-6444450476): a server-issued, readiness-bound local merge step, daemon squash execution, workspace safety, and result recording. The automatic trigger belongs to #1405. Tests supply ready gate facts explicitly and exercise the real claim/report path.

The owner's 2026-10-27 decision requires the same gates as GitHub projects. Existing ADR 0026 defaults and independent-review requirements remain in effect; explicit `human` and `shadow` settings survive. This change does not modify `mergeReadiness`, protected paths, or the GitHub executor. `enqueueLocalMerge` returns the existing readiness verdict and enqueues only an autonomous, ready, current local build. A stale result records the need for fresh facts and wakes the chief gate; it never retries the old decision as a merge.

## Runtime behavior

The command binds project, build, default branch, work branch, judged base/head, patch digest, required commands, commit message and identity. Claim revalidates the project policy and commands. The daemon executes structured commands directly, without an agent session, runs checks in a disposable worktree at the squash candidate, and rechecks the branch, digest and checkout before landing.

A prepared Git ref transaction compares the exact base and updates the default ref and receipt together. A clean default checkout advances through Git's index/worktree machinery; a clean alternate checkout receives only the default-ref update. Dirty or unknown checkouts suspend. Results and failed command names are recorded; suspension sends a notification containing the reason. Only a confirmed landing completes the card. Existing human branch-only delivery is unchanged.

The transaction fails closed if the installed Git lacks the required transactional/symbolic-ref commands. Abrupt process or filesystem failure between worktree advancement and ref commit can leave candidate changes in the initially clean checkout; a retry suspends rather than resetting files. This is deliberately conservative about concurrent user edits.

## Real artifacts

- [Terminal recording](boundary.cast): actual PTY output for clean default, clean alternate and dirty checkouts, including `git log -1`, status, default-branch commit count and file contents before/after.
- [Plain transcript](boundary.txt): the same recording as text. Two source commits become exactly one default-branch commit. The alternate checkout keeps its old file content; the dirty checkout keeps `USER UNCOMMITTED WORK` and its original default ref.
- [Verification results](results.txt): final command completion summaries.

## Tests first

The first decision regression failed with `action: update-ref` instead of `hold/worktree-dirty`. The initial executor and server tests failed because their runtime modules did not exist. The runner regression then failed because the old path called prepare/commit/merge/push instead of executing the structured command.

Further negative controls caught trailing patch-space loss, command-schema normalization, a moved work branch, interrupted result recording, a default ref rewind immediately before landing, a checkout dirtied while acquiring the transaction, and index stat-cache writes during observation. Each now has a regression assertion. The snapshot run initially failed on exactly the three new wire envelopes. Regeneration added 276 lines and deleted none; a complete snapshot comparison confirmed all other entries and fields remained identical.

## Judged digest read from the local repository

The acceptance e2e passes: `integration/test/g2t2-local-lifecycle.test.ts` runs 5 tests green, including both autonomous landing cases. The earlier blocker was a placeholder file record in `localGateFacts()` that could never match the daemon's real `git diff` digest, so every landing was refused with `recheck/patch-stale` and the card stayed in `review`. The premise that the server cannot read a local project was wrong: `requestMerge` already calls `git.listBranches(projectRow.localPath)`. `[server-digest-source.md](server-digest-source.md)` records the fix, its parity test and the negative control.

## Overlap and preservation

Open PRs touching changed files: #2036, #2031, #1993, #1940, #1928, #1867, #1727 and #1654. Most share the generated wire snapshot; #1993 and #1867 also share runner, claim, report and protocol files. #1940 shares the claim file; #1928 shares the runner. Their existing lines were preserved.

The recent #1988 and #2026 snapshot fields remain unchanged, and #2030 lifecycle/plan coverage remains in place. No recently merged feature was removed.

## Changed files

Runtime: `apps/daemon/src/git.ts`, `apps/daemon/src/local-merge.ts`, `apps/daemon/src/merge-decision.ts`, `apps/daemon/src/runner.ts`, `apps/server/src/lib/git.ts`, `apps/server/src/services/builds.ts`, `apps/server/src/services/local-merge-facts.ts`, `apps/server/src/services/local-merge.ts`, `apps/server/src/services/machine-claim.ts`, `apps/server/src/services/machine-finish-step.ts`, `apps/server/src/services/notifications.ts`, `packages/shared/src/git-ops.ts`, `packages/shared/src/protocol/machine-wire.ts`.

Verification: `apps/daemon/test/local-merge.test.ts`, `apps/daemon/test/merge-decision.test.ts`, `apps/daemon/test/runner-local.test.ts`, `apps/server/test/local-merge-digest.test.ts`, `apps/server/test/local-merge-facts.test.ts`, `apps/server/test/local-merge-landing.test.ts`, `apps/server/test/local-merge-local-digest.test.ts`, `integration/test/g2t2-local-lifecycle.test.ts`, `packages/shared/test/__snapshots__/snapshot.test.ts.snap`, `scripts/test-tmpdir.d.mts`, this directory and the issue's lessons entries.

The worktree's `COMMIT_MSG.txt` contains the requested commit message. No index writes, commit or push were performed, following the sandbox handoff instruction.

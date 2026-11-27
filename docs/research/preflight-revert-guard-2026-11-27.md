# Preflight Revert Guard: Prior-Art Research (2026-11-27)

Record of prior-art research before building `scripts/ops/revert-guard.mjs`.

Marks: `[measured]` (read or run directly), `[inferred]` (derived from measured facts), `[guessed]` (none used).

## Incident That Triggered This Gate

After `git reset --soft origin/main` in a local worktree, commit `a167446ce` was created on top of the then-current `origin/main` tip (`a7a390ea8`) `[measured]`. Because `git merge-base origin/main a167446ce` equaled `a7a390ea8` (the commit's parent), `a167446ce` deleted files and lines added earlier on `origin/main` by `ae7c898c8` (`scripts/ops/secret-scan.mjs`, `scripts/ops/secret-scan.test.mjs`, `.gitleaksignore`, and a line in `scripts/prepush.mjs`; 7 files, +138/-380) `[measured]`. Any gate that only inspects lines added after `merge-base(origin/main, HEAD)` cannot detect this failure mode because `a167446ce` sat directly on top of `origin/main` `[inferred]`.

## Sources

| Source | How it handles silent reverts | Trade-off for Cairn | Link |
|---|---|---|---|
| GitHub Docs: Rulesets, Branch Protection, and Merge Queue | Enforces PR review, linear history, and merge-queue CI against an up-to-date target branch; provides no native check that detects or blocks a commit whose tree silently restores older file content from before recent `main` commits `[measured]`. | Prevents direct force-pushes to `main`, which `green-main` already enforces, but does not stop a preflighted or queued head from dropping recent `main` additions after a stale reset/squash `[inferred]`. | [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) |
| Mergify Docs: Speculative Checks & Merge Queue | Runs speculative checks against cumulative `main + PR` states so stale branches are re-evaluated against newer `main` commits, and preserves `--first-parent` history for explicit reverts; has no content-revert detector `[measured]`. | Solves cross-PR staleness inside the queue (`speculative-queue.mjs` already implements this for Cairn), but if a lane's own commit carries an accidental revert from a soft-reset or bad conflict resolution, CI stays green `[inferred]`. | [Speculative Checks](https://docs.mergify.com/merge-queue/speculative-checks), [Mergify Merge Queue](https://docs.mergify.com/merge-queue/intro/) |
| Git Docs: `git-revert`, `git-range-diff`, `git-log` | `git revert` documents explicit reversal commits (`This reverts commit <sha>`); `git log --first-parent -m --raw` linearizes mainline history and records exact old/new blob OIDs (or absence) per commit `[measured]`. | Git's object database gives exact O(1) blob-OID equality checks without text-diff heuristics; comparing changed paths' `newOid` against `oldOid` in recent first-parent `main` commits catches exact content and add/delete reverts regardless of `merge-base` `[inferred]`. | [git-revert](https://git-scm.com/docs/git-revert), [git-range-diff](https://git-scm.com/docs/git-range-diff), [git-log](https://git-scm.com/docs/git-log) |
| Cairn `scripts/ops/preflight-fast-gate.mjs` & `a167446ce` (own baseline) | Checks `merge-base(origin/main, HEAD)..HEAD` for secrets, CI gates, and fix-test inversion; did not inspect `origin/main` history before `merge-base`, so `a167446ce` would pass preflight `[measured]`. | Adding a lookback blob-OID guard over the last 50 first-parent commits before `merge-base` closes the soft-reset / stale-squash gap in ~42 ms `[measured]`/`[inferred]`. | `scripts/ops/preflight-fast-gate.mjs` |

## Pattern That Fits Cairn — and Why

1. **Exact blob-OID lookback along first-parent `origin/main` history**: For each path modified, added, or deleted in `merge-base(origin/main, HEAD)..HEAD`, compare its resulting blob OID (`null` if deleted) against the pre-change blob OID (`null` if added) of the last `50` first-parent commits at or before `merge-base` (skipping root/shallow-boundary commits with no parents).
2. **Explicit opt-out for intentional reverts**: Allow either a standard `git revert` trailer (`This reverts commit <sha>`) matching the reverted commit, or an explicit path trailer (`Revert-landed: <path> - <reason>`) with a non-hollow multi-word reason (>= 10 chars, rejecting wildcards and placeholder words).
3. **Fail closed on unreadable git state**: Missing `refs/remotes/origin/main` or no merge-base exits `2` (`COULD_NOT_RUN`), never `0`.

## Replay & Timing Measurements on `origin/main`

- **Negative control (`a167446ce` against `a167446ce^`)**: Flagged all 4 reverted paths (`.gitleaksignore`, `scripts/ops/secret-scan.mjs`, `scripts/ops/secret-scan.test.mjs`, `scripts/prepush.mjs`) pointing to `ae7c898c8` (`dist = 3`), and did not flag the 3 legitimate feature files in `a167446ce` `[measured]`. Single-head check elapsed `42 ms` `[measured]`.
- **Replay over the last 300 first-parent commits on `origin/main`** (`a31b2d3e7`, lookback window `50`): `185 ms` log parse + `18 ms` check (`~203 ms` total across 300 commits); `0` hits in the most recent `190` commits, and `4` true intentional revert/removal commits in commits `190..299` (`0fa73ecbb` reverting `42869fc3e`, `606d9c2ec` reverting `67299d5d4`, `131b26ef8` removing a function added by `2f6b3f28a`, `670315c31` removing fields added by `6048e1dca`), with `0` detector false positives `[measured]`.

## Concrete Code Areas Touched

- `scripts/ops/revert-guard.mjs` (new standalone check module and CLI)
- `scripts/ops/revert-guard.test.mjs` (red-first regression, control, hollow-declaration, and error-exit tests)
- `scripts/ops/preflight-fast-gate.mjs` & `scripts/ops/preflight-fast-gate.test.mjs` (wire `REVERT_GUARD_STEP` as first step in `fastGatePlan`)
- `scripts/prepush.mjs` & `scripts/ops/push-queue.test.mjs` (add to `selfTests` and temp-repo preflight fixture)
- `docs/design/preflight-ci-verification.md` (document the revert guard and opt-out trailers)

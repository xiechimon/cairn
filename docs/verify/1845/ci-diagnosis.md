# PR #1862 CI diagnosis

First observed 2026-10-26. The failing `check` is inherited from main; no product-code or roster changes were made on this lane. A second round on 2026-10-26 re-verified the reproduction and established why the checked-in snapshot went stale. A third round on 2026-10-26T19:51Z re-verified both against head `d9da022f258bf45d051a3474970aafc4533d5300` and the newest CI run on it.

## Attribution

GitHub main and local `origin/main` both resolve to `0117480ad956c1b0bc6b1f5cef149fdd11a9802f`, re-confirmed after `git fetch origin main` at 2026-10-26T19:49Z; main's newest `ci` run is still the failed one on this commit. This commit is the parent of lane/1845 head `d9da022f258bf45d051a3474970aafc4533d5300` (the earlier rounds' head `65e0121dedc1bf8b54f7b668d5794d54c2b2738c` was folded into it); `git rev-list --count HEAD..origin/main` prints `0`, so rebasing is a no-op. All rows in `docs/lessons.md` remain.

The roster test, derivation, model identity, checked-in roster, lockfile, and workspace configuration have no differences between main and this branch (`git diff origin/main HEAD -- pnpm-lock.yaml` is empty, and so is the diff over `apps/server/src/services/merge-gate/`, the roster test, and `apps/daemon/package.json`). The installed `@earendil-works/pi-ai` version is `1.4.0`, matching the specifier at `10a26f29`, `0117480a`, and the branch head.

Main's own `check` failed on `0117480a` with the identical assertion: run 40351380688 / job 121672041735, started 2026-10-26T15:38:58Z; its job log carries the byte-identical line `AssertionError: expected { vendors: { …(162) }, …(1) } to deeply equal { vendors: { …(157) }, …(1) }` in `test/merge-gate-model-roster.test.ts` (fetched this round with `gh run view 40351380688 --log-failed`). Issue #1855 ("main red: check on 0117480a") tracks it and stays open until a later main commit is green.

## Timeline of the stale snapshot

1. PR #1818 (server(1774), squash `0117480a`) introduced `model-roster-data.ts` and the roster test. Its head `ad97a60dd15645f91def564659815cba04986734` pinned `@earendil-works/pi-ai` `1.0.4` in `apps/daemon/package.json` and the lockfile, and its green `check` (2026-10-26T09:14:11Z to 09:24:08Z) installed 1.0.4. The checked-in 157-entry snapshot therefore equals the 1.0.4 catalogs.
2. PR #1824 (daemon(1808), commit `241205d7735d15ac1b7ad9a7c1bc958e05a41562`) upgraded pi and `@earendil-works/pi-ai` from 1.0.4 to 1.4.0 and merged into main at 2026-10-26T12:32:06Z, changing the single-lab and radius catalogs.
3. #1818 merged at 2026-10-26T15:38:52Z, about three hours after its last green run, without re-running checks against the moved base. The squash carries the 1.0.4-derived snapshot next to the locked 1.4.0, so main's check (started 15:38:58Z) failed: the installed 1.4.0 catalogs derive 162 vendor entries against the checked-in 157, differing by 13 additions (for example `claude-haiku-5-5`, `gemini-4-argon`, `minimax-m3.1-flash`) and 8 removals (for example `gpt-5.2-chat-latest`, `mimo-v2.5`, `open-mixtral-8x7b`). PR #1871 independently pinned the snapshot provenance to pi-ai 1.0.4.

## Reproduction

Run from this worktree (re-verified 2026-10-26T19:16Z under the heavy lock):

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts 2>&1 | tee docs/verify/1845/roster-branch-rerun.log'
```

Observed: exit 1, one failed test and one passed test, the same 162-versus-157 diff as CI. See [this round's log](roster-branch-rerun.log).

A third run on head `d9da022f` (2026-10-26T19:51Z, same command, output to [roster-branch-rerun-2.log](roster-branch-rerun-2.log)) again exited 1 with the identical diff: the installed 1.4.0 catalogs add 13 vendor entries (for example `claude-haiku-5-5`, `gemini-4-argon`, `minimax-m3.1-flash`) and drop 8 (for example `gpt-5.2-chat-latest`, `mimo-v2.5`, `open-mixtral-8x7b`) against the checked-in 157.

An earlier round in this lane exported `origin/main` with `git archive` into a temp directory, linked this worktree's installed node_modules, and ran the same test there: exit 1 with the identical roster mismatch. That comparison isolates source changes and is not an independent dependency installation; see [branch log](roster-branch.log) and [main log](roster-main.log).

The fetched CI failure shows the same diff: https://github.com/xiechimon/cairn/actions/runs/40363169898/job/121713723552

The newest CI failure on head `d9da022f` (run 40386804245 / job 121797123255, started 2026-10-26T19:26:49Z) shows the same assertion line in its job log.

## Resolution path

PR #1861 (branch `lane/1855`) regenerates the snapshot from the installed 1.4.0 catalogs and corrects the GLM maker-vendor derivation; it was CLEAN and mergeable when checked on 2026-10-26T19:09Z and still open, green, and MERGEABLE at 2026-10-26T19:49Z, with `origin/main` still at `0117480a`. Merging it turns main green, and issue #1855 then closes automatically on the next green main commit. This lane needs no roster change, which would collide with #1861 on `model-roster-data.ts`; after #1861 merges, rebasing this lane on the green main clears the PR's `check`.

## Other checks

Observed through `gh pr view 1862 --json statusCheckRollup,body`: `check` is the only failing check; `pr-evidence` and all four e2e shards passed. The body includes the six required sections and checked acceptance items. No PR-body edit is needed for the reported failure. The newest rollup on head `d9da022f` (2026-10-26T19:49Z) is unchanged: every other check, including `pr-evidence`, is green.

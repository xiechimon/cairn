# Issue #2127: guard product squash merges by PR opener identity

The API regression ran before implementation. Nine unsafe or unknown opener cases returned HTTP 202 instead of 409 (`red.log`). After the guard, all 136 merge API tests pass (`green.log`). The tests inspect recorded HTTP traffic: rejected requests send no merge PUT and preserve messages, steps and task phase. Allowed requests retain SHA-bound squash behavior. Already-merged bot PR recovery remains available.

The guard applies only to `xiechimon/cairn`, case-insensitively. The existing commit-author workflow is unchanged. This is prevention through the product API; it does not establish which external merge path produced the reported main commit or repair historical authorship. A subsequent main commit's author and Actions result must be checked after delivery; this worktree task does not push or merge.

## Overlap

Live lookup on 2026-10-28 used `commit-author`, `bot opener`, and the four implementation/documentation paths. Open PR #2125 overlaps build services, #2103 overlaps the GitHub adapter, and #2121, #2099 and #2090 overlap identity documentation. Proceed on the assigned lane with additive changes, preserving their existing lines. Recently merged #2084 and #2050 overlap build services; #2050 also overlaps the API tests. No lines added by those PRs are removed. The seven-day semantic lookup also found related merged identity work #2033, #1806, #2025 and #1669; #1475 concerns issue-text handling and is unrelated to merge authorship. Related identity work is extended with a product API boundary, without changing the external helper or merge workflow.

The first broad Vitest run exposed two exact live-response expectations missing the added opener fields. Those expectations now assert both fields explicitly; no comparison was weakened. The lesson is recorded in `docs/lessons/2127-pull-shape-expectations.md`.

## Reproduction

```sh
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/pr-merge-api.test.ts -t '#2127'
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/pr-merge-api.test.ts
node --test scripts/commit-author.test.mjs scripts/commit-author-policy.test.mjs
```

## Final verification

- `pnpm prepush`: PASS, 30 checks, under `flock /tmp/cairn-heavy.lock`.
- Its `node scripts/prepush-vitest.mjs` step: 193 files and 2606 tests passed.
- Affected E2E through prepush: 4 specs, 26 tests passed; the runner completed teardown.
- `pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse`: passed.
- Commit-author script tests: 17 passed.
- English, single-use-helper and comment gates: each reported 0.
- Lessons ledger and `git diff --check`: passed.

The sandbox prevented prepush from fetching main, so it used local `origin/main`. No push or merge was performed. `COMMIT_MSG.txt` contains the commit message for the dispatcher.

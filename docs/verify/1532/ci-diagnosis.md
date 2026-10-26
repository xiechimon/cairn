# PR #1872 CI diagnosis

The red `check` on this branch is inherited from main; the harness benchmark changes are docs
and `integration/eval/harness-page-bench/` only. Two distinct test failures share the job:

1. A deterministic roster snapshot mismatch, present since main `0117480a` (PR run 40363549951
   onwards) and still failing in every run since, latest 40387215802 (see the re-verification
   section at the end).
2. An intermittent curate CLI argv failure in `trajectory-reflect.test.ts`, first hit by this
   branch in run 40375352852 but present in main's own code (it failed main's 09:55 run before
   this branch's first run). See `trajectory-flake.log` beside this document.

The `issue-label-gate` failure in run 40375352852 is a transient GitHub API 504, not a branch
problem.

## Failure 1: roster snapshot mismatch (deterministic, from main)

The root cause is a squash-merge recombination: the roster snapshot landed with a pi-ai 1.0.4
lockfile in its own PR, but on top of main's pi-ai 1.4.0 lockfile, and no CI run had tested
that combination.

### Evidence

- PR CI: https://github.com/xiechimon/cairn/actions/runs/40369203330 (earlier run on the same head: 40363549951, also a failure)
- Main CI: https://github.com/xiechimon/cairn/actions/runs/40351380688
- Both runs fail `test/merge-gate-model-roster.test.ts` at `the checked-in snapshot matches the installed pi model catalogs`, with 162 derived vendor entries versus 157 checked-in entries. In those two runs it is the only failing test; the later run 40375352852 adds the flake below.
- Main is `0117480ad956c1b0bc6b1f5cef149fdd11a9802f`, the direct parent of branch commit `3f54ec8e`. GitHub's main ref matched the local `origin/main` ref during diagnosis, so the branch is already based on current main; no rebase was necessary. The latest branch head `d44494cf` and the CI merge commit `adaaafc` carry identical trees (`git diff adaaafc d44494cf` is empty).
- `git diff origin/main HEAD` changes only files under `integration/eval/harness-page-bench/` and `docs/verify/1532/`.
- The roster test, derivation implementation, checked-in roster, and `pnpm-lock.yaml` have identical Git blob hashes on main and the branch.
- Installed `@earendil-works/pi-ai` is version `1.4.0`, matching the lockfile. The registry tarball for 1.4.0 (`dist.shasum 2ddca1029bbe97e26298d998d3a66d09db7759e2`) is byte-identical to the installed `dist/providers/data`, so the local catalogs are not drifted from the registry.
- CI's derived catalog adds entries including `claude-haiku-5-5` and removes entries including `mimo-v2.5`. This is a catalog/snapshot content mismatch, rather than an ordering-only difference.
- PR `pr-evidence` passed; the body contains all six required sections and checked acceptance items.

### Root cause: the snapshot was generated from pi-ai@1.0.4, then recombined with main's pi-ai@1.4.0 lockfile

- The checked-in snapshot equals `deriveModelRoster` over pi-ai@1.0.4's shipped catalogs exactly: 157 vendors and 3 aliases, deep-equal (see `roster-provenance.log` beside this document).
- The snapshot was introduced by PR #1818 (`lane/1774`, head `ad97a60d`). That branch's merge-base with main is `d2533d10` (2026-10-26 08:56 UTC), which predates `241205d7 daemon(1808): upgrade pi from 1.0.4 to 1.4.0` (2026-10-26 12:32 UTC) landing on main.
- `ad97a60d`'s `pnpm-lock.yaml` pins pi-ai@1.0.4 (read from the commit object), so PR #1818's green `check` ran on a tree where the 1.0.4-derived snapshot matched the installed 1.0.4 catalogs.
- The squash merge `0117480a` (2026-10-26 15:38 UTC) kept the branch's roster files byte-identical (`git diff ad97a60d 0117480a -- apps/server/src/services/merge-gate/ apps/server/test/merge-gate-model-roster.test.ts` is empty) while taking main's lockfile at pi-ai@1.4.0 (the lockfile diff between the two trees is only the pi-ai bump). No CI run had ever tested that snapshot/lockfile combination; main's first run on the merged tree is the red run above. The prior main commit `10a26f29` was green (run 40350946622).
- pi-ai@1.4.0's catalogs derive 162 vendors. The mismatch is between two static inputs (checked-in data versus immutable registry tarball), so it is deterministic, not a flake.

### Disposition

Do not change the roster in this benchmark branch. The mismatch already fails on main and needs correction there: regenerate `MODEL_VENDORS` / `MODEL_ALIASES` from the installed pi-ai@1.4.0 catalogs, so the snapshot test pins the current lockfile again. The general lesson for the main-side fix: a lane that ships a snapshot derived from dependency data must regenerate it when a dependency bump lands between its branch point and its merge, because a green PR `check` only covers the tree the PR branch was tested on, not the squash-merged result. No production code or tests were changed for this diagnosis.

## Failure 2: trajectory-reflect curate CLI argv flake (intermittent, from main)

Run 40375352852 additionally failed `a dismissed candidate absorbs later recurrences and is
never promoted` with `Experience curation failed: Invalid arguments or database/input/output
I/O failed`. Full evidence, local reproduction, and the unmasked stack are in
`trajectory-flake.log` beside this document. Summary:

- The same tree passed this file at 16:54 (run 40363549951) and 17:30 (run 40369203330) and
  failed at 18:10 (run 40375352852); the three branch heads differ only under `docs/verify/1532/`.
- The identical assertion failed on main at 09:55 (run 40303352406, head `260b8a4c`, an
  ancestor of this branch's base) as the only failure of that run, and a sibling test in the
  same file failed with the same CLI catch-all message on lane/1614 at 17:10 (run 40366138199).
- Reproduced locally under concurrent load: 7 of 176 file runs failed (six inspected logs all
  show the CLI catch-all assertion). Root cause: `newRecordId()`'s 64-symbol alphabet includes
  `-`, so 1 in 64 candidate ids begins with a dash; the tests pass such an id as a separate
  argv token and Node `parseArgs` strict mode rejects `--dismiss -XYZ` as an ambiguous option
  (`ERR_PARSE_ARGS_INVALID_OPTION_VALUE`); the CLI catch-all hides the real error behind
  `Invalid arguments or database/input/output I/O failed` and exits 1.

Disposition: the trajectory code landed with PR #1664 and is unchanged on this branch; the fix
belongs on a main-side lane (the CLI argument handling and/or the id argv form used by callers,
including the curation tests). No production code or tests were changed on this branch.

## Failure 3: issue-label-gate (transient GitHub API outage)

Run 40375352852's `issue-label-gate` job failed with `HTTP 504: 504 Gateway Timeout` while
`scripts/issue-label-gate.mjs` ran `gh issue list` (job log 121756803670). The gate exits 1
only when the `gh` call itself fails; labeling violations are reported informationally with exit
0. Re-running the script locally on this branch exits 0 (42 informational violations, same as
the open-issue backlog), so the red check is a transient GitHub API outage, not a branch
problem. A rerun of the CI job goes green when the API responds.

## Local reproduction

Executed under the shared heavy-check lock:

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts 2>&1 | tee /tmp/cairn-1532-roster.log'
```

Exit status: 1. One test failed and one passed. The snapshot comparison reproduced the exact CI assertion: 162 derived vendor entries versus 157 expected entries. See `roster-test.log` beside this document for the full output. Together with main's identical inputs and failing CI run, this confirms the failure is inherited from main.

## Snapshot provenance check

Executed under the shared heavy-check lock. The pi-ai@1.0.4 tarball was downloaded from the registry and extracted to `/tmp/pi-ai-1.0.4`:

```sh
curl -sL https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-1.0.4.tgz -o pi-ai-1.0.4.tgz
tar xzf pi-ai-1.0.4.tgz -C /tmp/pi-ai-1.0.4
```

A temporary vitest spec, identical to `apps/server/test/merge-gate-model-roster.test.ts` except that its catalog directory was `/tmp/pi-ai-1.0.4/package/dist/providers/data`, asserted `deriveModelRoster(catalogs)` deep-equals `{ vendors: MODEL_VENDORS, aliases: MODEL_ALIASES }`:

```sh
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/tmp-roster-provenance.test.ts --project @xiechimon/cairn --disable-console-intercept
```

Result: 1 passed, with `pi-ai@1.0.4 derivation: 157 vendors, 3 aliases` and `checked-in snapshot: 157 vendors, 3 aliases`. The spec was deleted after the run; the full output is in `roster-provenance.log`. This pins the snapshot's provenance to pi-ai@1.0.4 and completes the recombination story above.

## Re-verification on head `f9941cad` (run 40387215802)

The push of the diagnosis commit itself ran as
https://github.com/xiechimon/cairn/actions/runs/40387215802 (started 2026-10-26T19:29:38Z).
The `check` job is red again, and this time the roster test is the only failure in the entire
job: 362 test files (1 failed, 361 passed), 5131 tests (1 failed, 5130 passed). The
trajectory-reflect flake and the issue-label-gate 504 from run 40375352852 did not recur, and
`pr-evidence` plus every other check on this head is green. The inherited roster failure is
unchanged, and nothing in this branch's diff can turn it green before main regenerates the
snapshot.

Main's red is now tracked in issue #1855 ("main red: check on 0117480a", labels `main-red` and
`batch:now`, assignee xiechimon), which links the same failing main run 40351380688 and the same
roster assertion.

Local reproduction was repeated as three consecutive runs under the shared heavy-check lock; all
three exit 1 with the identical assertion (162 derived vendors vs 157 checked-in). Full output in
`roster-rerun.log` beside this document. The compared inputs are two static artifacts (the
checked-in data and the lockfile-pinned pi-ai@1.4.0 registry tarball), so the failure cannot
be timing-dependent; the identical assertion across the four PR runs, main's own failing run,
and three identical local runs makes it deterministic.

Rebase: `origin/main` is still `0117480a`, which is this branch's merge-base, so the branch is
already based on current main and the rebase is a no-op. `docs/lessons.md` keeps every row; the
branch adds exactly one row (the vitest reporter lesson) and it stays.

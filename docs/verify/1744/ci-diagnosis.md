# PR #1868 CI diagnosis

Measured on 2026-10-26, branch `lane/1744`. First round at head `9e600d2095a42f34c0c003b984378c58b0a88bd5`; root-cause round at head `46c547a453064f40bb73a16f44ceaeb92ba15e49`; recheck round at head `f95fdb684aef9135fe4dfec96ccb78fc45e02141`; flake round at head `ff8564f959ff2e63348eb1f00f98f5728c255600`; mechanism round after rebasing onto main `e03f60d4e67d0a0dded892c1e5c5d7506d5b495e`.

The roster snapshot failure is inherited from main, rather than caused by the compaction change. No roster implementation or snapshot was changed during this diagnosis.

## Evidence

- GitHub main and local `origin/main` both resolve to `0117480ad956c1b0bc6b1f5cef149fdd11a9802f`. `git rev-list --left-right --count origin/main...HEAD` prints `0 1`. Main is already an ancestor; a rebase would be a no-op.
- [Main check failure](https://github.com/xiechimon/cairn/actions/runs/40351380688/job/121672041735) and [PR check failure](https://github.com/xiechimon/cairn/actions/runs/40371687259/job/121743789660) both fail `the checked-in snapshot matches the installed pi model catalogs`, receiving 162 vendors versus 157 expected.
- The roster test, derivation, snapshot, daemon dependency manifest, and lockfile have no diff between main and this branch (`git diff origin/main HEAD --stat -- apps/server pnpm-lock.yaml apps/daemon/package.json` is empty).
- Installed `@earendil-works/pi-ai` is version `1.4.0`. Calling the real `deriveModelRoster` with its installed provider JSON files locally produces 162 vendors; the checked-in snapshot contains 157. Aliases match. There are 13 additional IDs and 8 removed IDs, including added `claude-haiku-5-5` and removed `gpt-5.2-chat-latest`.
- PR `pr-evidence` succeeded. Its body contains all six required sections and checked acceptance items.
- In the failing PR run only this one test is red (1 failed, 5135 passed); the e2e shards and every other job are green, so the branch's own compaction work is unaffected.

## Root cause: the squash merge of #1818 crossed main's pi upgrade

The snapshot was authored against pi-ai `1.0.4` and met pi-ai `1.4.0` only at the squash merge:

- `241205d7` (`daemon(1808): upgrade pi from 1.0.4 to 1.4.0`) landed on main while PR #1818 was in review. The PR branch (`lane/1774`, head `ad97a60dd15645f91def564659815cba04986734`) predates it: `241205d7` is not an ancestor of the PR head, its `apps/daemon/package.json` pins `@earendil-works/pi-ai` `1.0.4`, and its lockfile carries `1.0.4` (integrity `sha512-/Eu5R0gfor6wcmRcVyOmulUiZmsHJ0bKu5wXXnpCoSHF3y4FnW4fgnjRlLjNza8NJWXdvW5Uew90Zukx7Sh2rw==`). The PR diff never touches the pi-ai version line.
- The checked-in snapshot equals the pi-ai `1.0.4` catalog exactly. Loading `https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-1.0.4.tgz` and running the real `deriveModelRoster` over its `dist/providers/data/*.json` yields 157 vendors and 3 aliases, and the derived roster serializes identically to `MODEL_VENDORS` / `MODEL_ALIASES`.
- PR #1818's own CI was green against that 1.0.4 install: run [40297978027](https://github.com/xiechimon/cairn/actions/runs/40297978027) (head `ad97a60d`) passed `check`, and `test/merge-gate-model-roster.test.ts` passed at 09:20.
- The published `1.4.0` tarball (integrity `sha512-hQM/C4+1w8rHYACzDDf+0vQMnEnpzIop1tptIERVgR3ZeT/hHSzBNG8PaWPgxWQjqSeKCyBZSyp8uTT6eKK1pQ==`, matching the lockfile) yields 162 vendors. The local install is byte-identical to that tarball (`diff -rq` clean over `dist/providers/data`), so the installed catalog is the published truth, not a local mutation.
- The squash merge `0117480a` (15:38:52) combined the roster feature with main's pi-ai `1.4.0`; the snapshot was stale from the moment of merge. The first main run of that commit (started 15:38:55) failed with the same 162-versus-157 assertion.

Issue #1855 tracks the main failure and carries the fix plan: regenerate the snapshot from the installed `1.4.0` catalogs on main; it closes automatically once a later main commit is green.

## Disposition

The defect belongs to main, so this branch does not regenerate the snapshot (a roster fix here would duplicate the #1855 lane and touch the fresh #1774 surface outside this lane's scope). PR #1868 stays blocked on `check` until #1855 lands; after main is fixed, a rebase of this branch (or any new run on the fixed main) is expected to go green without roster changes.

## Isolated local test

Executed under the shared lock:

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts 2>&1 | tee /tmp/cairn-1744-roster.log'
```

Result: exit 1, one failed test and one passed test. The exact 162-versus-157 assertion reproduced in isolation, excluding test order as a necessary trigger. Full output is in `roster-test.log` beside this report.

## Recheck at head `f95fdb68`

Measured 2026-10-26 at the rebased head, after CI ran red again with the same excerpt. The causal chain is unchanged; this round refreshes the run identifiers and the state of the fix lane.

- PR run [40378156702](https://github.com/xiechimon/cairn/actions/runs/40378156702/job/121766806475) fails `check` with the same single test: `the checked-in snapshot matches the installed pi model catalogs` (1 failed of 5136 tests). Every other job is green, including `pr-evidence` and the four e2e shards.
- Main is still `0117480a` and still red: `ci` run [40351380688](https://github.com/xiechimon/cairn/actions/runs/40351380688/job/121672041735) fails the identical test with the identical 162-versus-157 assertion (verified from the job log, not from this report's earlier text). The success run [40351380559](https://github.com/xiechimon/cairn/actions/runs/40351380559) beside it is the `commit-author` workflow, not `check`.
- Issue #1855 is still OPEN. The fix lane now exists as PR #1861 (`lane/1855`, `server(1855): refresh the model roster snapshot from pi 1.4.0 catalogs`): all checks green, GitHub reports MERGEABLE, not yet merged. Until it lands, main stays red and every branch containing main inherits the failure.
- The isolated local test was re-run at this head under the same shared lock and still exits 1 with the 162-versus-157 assertion; the fresh output is appended to `roster-test.log`. For example, the installed 1.4.0 catalog adds `voxtral-small-2507` and drops `open-mistral-nemo`, `open-mixtral-8x22b`, `open-mixtral-8x7b` relative to the checked-in snapshot.
- Roster inputs keep zero diff versus main: `git diff origin/main HEAD --stat -- apps/server pnpm-lock.yaml apps/daemon/package.json` is empty.

Disposition unchanged: the defect belongs to main, this branch does not regenerate the snapshot, and once #1861 lands a rebase or any new run on the fixed main is expected to go green without roster changes.

## Flake round at head `ff8564f9`

Measured 2026-10-26 after the `ci` run [40384060324](https://github.com/xiechimon/cairn/actions/runs/40384060324/job/121787536207) went red with two failing tests instead of one. The roster verdict above is unchanged; the second failure is a same-sha CI flake in code this branch does not touch.

### The new failure

`test/trajectory-reflect.test.ts > human confirmation promotes only with two builds of evidence` fails with:

```
AssertionError: expected 'Experience curation failed: Invalid a…' to contain 'needs evidence from 2 different build…'
- needs evidence from 2 different builds (has 1)
+ Experience curation failed: Invalid arguments or database/input/output I/O failed
```

That received message is the catch-all branch of `apps/server/src/trajectory-curate-cli.ts`: a non-CurateError exception was thrown inside the `--confirm` child (config load, database open, or the confirm path), and the catch-all discards the error class, so the run log cannot name the underlying transient error. The same test's `--in` child succeeded moments earlier (the candidate id it read back from the database was valid; a failed `--in` would have produced the usage-error message instead), so the child ran and only a later database-opening invocation failed.

### Same-sha evidence that it is a flake

On the same day two other branches hit the identical signature — the same test file, a different test inside it, the same catch-all message — while sibling runs of the identical sha were green:

- lane/1532, sha `d44494cf`: run [40375352852](https://github.com/xiechimon/cairn/actions/runs/40375352852) is red with `a dismissed candidate absorbs later recurrences and is never promoted` (the `--dismiss` child exits with the same catch-all; its preceding `--in` child had succeeded, same as above). Runs [40375352788](https://github.com/xiechimon/cairn/actions/runs/40375352788) and [40375352935](https://github.com/xiechimon/cairn/actions/runs/40375352935) of the identical sha are green.
- lane/1837, sha `3607d2ee`: run [40381375540](https://github.com/xiechimon/cairn/actions/runs/40381375540) is red the same way in the same file. Runs [40381375512](https://github.com/xiechimon/cairn/actions/runs/40381375512) and [40381375657](https://github.com/xiechimon/cairn/actions/runs/40381375657) of the identical sha are green.

One commit sha failing in one run and passing in two sibling runs is non-deterministic by definition. Neither of those branches' diffs touches trajectory curation, and the failing test differs between branches while the failure signature is identical — the shape of a load-dependent transient on the shared 2-vCPU runner, not of a code change. The integration-stack comment in `.github/workflows/ci.yml` records the precedent for this runner class: suites run together on the 2-vCPU runner have false-reded before with the same sha, while the same test passed locally.

### Local reproduction

Executed under the shared lock:

- `pnpm --filter @xiechimon/cairn exec vitest run test/trajectory-reflect.test.ts`, five consecutive runs: 12 of 12 tests green each time.
- `VITEST_PROJECT_SET=light pnpm test` (the exact CI command, full 362-file light project set): 5135 of 5136 tests green; the only red test is the roster snapshot test from the section above. The trajectory-reflect test passes under the full local parallel load as well.

`git diff origin/main HEAD --stat` lists only the daemon compaction files, their test, `docs/spec/26-pi-session-runtime-and-trust-surface.md`, `docs/lessons.md`, and `docs/verify/1744/`; no trajectory-curate, server, or shared file is touched.

### Disposition

The trajectory-reflect red is a CI-load flake in shared code, not caused by this branch; no code change is made here. Naming the exact transient error would require the curate CLI to stop discarding the error class in its catch-all, a change to shared server code outside this lane's daemon scope. The roster verdict is unchanged: main is still `0117480a` and red (issue #1855), fix lane PR #1861 is green and mergeable but unmerged. A rebase on `origin/main` remains a no-op: `git rebase origin/main` reports the branch up to date, and the left side of `git rev-list --left-right --count origin/main...HEAD` stays `0` (origin/main holds no commit this branch lacks).

## Mechanism round after the rebase

Measured 2026-10-26 after the `ci` run [40392630191](https://github.com/xiechimon/cairn/actions/runs/40392630191/job/121817300220) on head `eec4ab57` failed the same single test again (only `check` red; `pr-evidence`, all four e2e shards and every advisory gate green). This round names the transient the flake round could not: the failure is not load-dependent, it is record-id randomness.

### Capturing the hidden exception

The curate CLI's catch-all discards the error class, so the run log alone cannot name it. A temporary instrumentation of that one fallback (printing `String(error)`; reverted after capture, `git diff` on the CLI is empty again) plus repeated parallel runs of the test file under the shared lock reproduced the CI signature locally and printed:

```
Experience curation failed: Invalid arguments or database/input/output I/O failed: TypeError [ERR_PARSE_ARGS_INVALID_OPTION_VALUE]: Option '--confirm' argument is ambiguous.
```

### Mechanism

`newRecordId` (`apps/server/src/lib/ids.ts`) builds ids from the alphabet `A-Za-z0-9-_`. The first character is `-` when `bytes[0] & 63 == 62` (byte 62 or 126; 2/256 = 0.78% per id):

1. The first `--in` child inserts the memory candidate with that id; the database and the JSONL round trip do not care, so the test successfully reads the id back.
2. The follow-up `--confirm <id>` (or `--dismiss <id>`) spawns the CLI with the id as its own argv token. Node's `util.parseArgs` (strict mode, the default) refuses a dash-prefixed token as an option's value and throws `ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '--confirm' argument is ambiguous`.
3. The CLI's catch-all maps that `TypeError` to `Invalid arguments or database/input/output I/O failed`, the exact received string in the CI assertion.

Minimal reproduction, no flake needed:

```sh
node -e "const {parseArgs}=require('node:util');parseArgs({options:{confirm:{type:'string'}},args:['--confirm','-Ab1cd']})"
```

fails with the same code and message; `--confirm=-Ab1cd` succeeds. Ids whose first character is `_` or a letter pass untouched.

The failure is deterministic once the id is drawn and probabilistic per run: two tests in the file feed a freshly generated candidate id to `--confirm`/`--dismiss` (`human confirmation promotes only with two builds of evidence`, `a dismissed candidate absorbs later recurrences and is never promoted`), so a light-suite run carries roughly a 1.6% chance of one of them going red. That matches the cross-lane record: this branch's two runs ([40384060324](https://github.com/xiechimon/cairn/actions/runs/40384060324), [40392630191](https://github.com/xiechimon/cairn/actions/runs/40392630191)) failed the `--confirm` test, while lane/1847's run [40393106160](https://github.com/xiechimon/cairn/actions/runs/40393106160) on `790e460f` (started 20:09, three minutes after this branch's 20:06 run) failed the `--dismiss` test in the same file with the identical catch-all message — plus the lane/1532 and lane/1837 hits recorded in the flake round, same signature.

### Local reproduction

Executed under the shared lock, on tree `eec4ab57` — the exact tree the failing CI run 40392630191 checked out (its merge ref `39bab49a` has the identical tree hash):

- 34 parallel full-file runs of `test/trajectory-reflect.test.ts` (two waves): two failures, each the exact CI signature — one in the `--confirm` test (the captured exception above), one in the `--dismiss` test. Every other run green.
- `VITEST_PROJECT_SET=light pnpm test` pinned to two CPUs (the CI runner class): 5137 of 5137 green, trajectory-reflect included. CPU pressure alone does not trigger it; the id draw does.
- `git diff origin/main HEAD --stat -- apps/server/src/trajectory-curate-cli.ts apps/server/src/lib/ids.ts apps/server/test/trajectory-reflect.test.ts` is empty: the flake mechanism is entirely main's code.

The flake round's "load-dependent transient on the shared 2-vCPU runner" guess is corrected here: parallel load only re-rolls the id dice faster; the trigger is the leading dash.

### Disposition

Unchanged: no code change on this lane, the fix belongs on main in server scope. Either `newRecordId` avoids a leading `-`/`_`, or the option is passed as `--confirm=<id>` (both one-line, the latter needs no data migration and is the shape the CLI already accepts). Until one lands, every lane carries the same ~1.6% flake on `trajectory-reflect.test.ts`.

## Roster fix landed on main; rebase

`2ca0e7cd` refreshed `model-roster-data.ts` from the installed pi 1.4.0 catalogs and main's `ci` runs on `510e4146` ([40393778063](https://github.com/xiechimon/cairn/actions/runs/40393778063)) are green, so the inherited roster red no longer blocks this branch. This branch was rebased onto main `e03f60d4e67d0a0dded892c1e5c5d7506d5b495e`: the rebase replayed the single lane commit onto the new base without conflicts, `docs/lessons.md` keeps every row from both sides, and `docs/verify/1744/` survives main's evidence prune.

## Delivery-surface timeout round at head `0f96de5b`

Measured 2026-10-27 after the `ci` run [40441024633](https://github.com/xiechimon/cairn/actions/runs/40441024633/job/121981138929) (started 02:53:19Z) on PR head `0f96de5b` — the exact local HEAD — went red on a new test: `test/delivery-surface.test.ts > done channel delivery-surface backfill (#704 / B-C16) > failure mode 7: changesDiff empty string -> files empty and reported (empty commit)` with `Test timed out in 5000ms`. Only `check` is red; the four e2e shards, `pr-evidence` and every advisory gate are green. The file ran 8 tests, 7 green, 7102ms total.

### Not this branch, and not the file's own history

- `git diff origin/main HEAD --stat -- apps/server apps/web packages pnpm-lock.yaml` is empty: the daemon compaction change cannot reach this in-memory server test.
- The same file in this PR's four earlier runs was green and fast: 981ms ([40371687259](https://github.com/xiechimon/cairn/actions/runs/40371687259)), 995ms ([40378156702](https://github.com/xiechimon/cairn/actions/runs/40378156702)), 616ms ([40384060324](https://github.com/xiechimon/cairn/actions/runs/40384060324)), 586ms ([40392630191](https://github.com/xiechimon/cairn/actions/runs/40392630191)). The failing run is 7-12x the file's own CI norm: 7102 = 5002ms (fm7) + ~2100ms across the seven green tests (~300ms each versus the usual 75-125ms).
- Main's head `c69a8a06` ran the identical file green in 1988ms in [40440308594](https://github.com/xiechimon/cairn/actions/runs/40440308594) minutes before this PR's run: same code, same day, 15 minutes apart. The transient is time-local, not sha-local. The two runs' totals (1988ms green, 7102ms red) also show the api.github.com round trip was already 2-3x its usual cost in that window.

### Mechanism: `done` performs a real unauthenticated request to api.github.com inside a 5s test budget

`setupWorld` boots the server without a `githubFetch` stub while creating a github-kind project `octocat/Hello-World`. Every `done` on that project then runs `finishStep` (`apps/server/src/services/machine-finish-step.ts`) → `githubBranchPulls` (`apps/server/src/lib/github.ts`) → `conditionalGetJson(deps.githubFetch ?? fetch, ...)`, a real unauthenticated HTTPS GET to `https://api.github.com/repos/octocat/Hello-World/pulls?...` guarded by `AbortSignal.timeout(15_000)`. `conditionalGetJson` catches fetch errors and returns null, but only after the abort signal fires. Vitest's default `testTimeout` is 5000ms, so a single request that stalls longer than ~4.7s reds whichever test drew it; failure mode 7 drew it this run. `delivery-surface.test.ts` is the only server test file that both creates github-kind projects and calls `/api/machine/done` without stubbing `githubFetch`: the other five `githubRepo` files without a stub never call done, and 22 files do stub it.

Exclusions: `claim`'s hold is bounded at `claimHoldMs` 200ms; `startBuild` and `GET /api/builds/:id/changes` are local (`readBuildChanges` takes only `{db, reposDir}`); failure modes 1 and 2 red in the reproduction below without ever calling the changes endpoint, so the stall sits inside `done` itself. CPU starvation alone cannot produce one test at 5s while its seven siblings run ~300ms.

### Reproduction under the shared lock

A local TCP proxy that accepts connections and never answers, wired into Node 26's global fetch with `NODE_OPTIONS=--use-env-proxy https_proxy=http://127.0.0.1:18889` (verified first with a logging proxy: the process issues `CONNECT api.github.com:443`):

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'NODE_OPTIONS=--use-env-proxy https_proxy=http://127.0.0.1:18889 pnpm exec vitest run apps/server/test/delivery-surface.test.ts'
```

Result: the exact CI signature — all seven done-bearing tests red with `Test timed out in 5000ms` (5001-5002ms each), while failure mode 5 (hosted project, no `githubRepo`, so no network call) stays green. Baseline with healthy network: 8 of 8 green, done-bearing tests 305-708ms each (the first carries DNS and TLS setup), failure mode 5 71ms — the network round trip dominates every red-able test's duration. A plain `fetch` of the same URL through the stalling proxy hangs ~300s (undici headers timeout), far past both the 15s abort and the 5s budget.

### Disposition

A transient network-stall flake rooted in main's test design — real unauthenticated network I/O inside a 5s-budget light-suite test — not caused by this branch; no code change on this lane. The fix belongs on main in server scope: give `setupWorld` a `githubFetch` stub (the shape `step-claim-report.test.ts` already uses) or otherwise keep light-suite tests off the real API. A rerun of the same sha is expected to go green: this PR's four earlier runs and main's current head are green on this file. Rebase state is unchanged: after `git fetch origin`, `git rev-list --left-right --count origin/main...HEAD` is `0 1`, so rebasing on `origin/main` remains a no-op.

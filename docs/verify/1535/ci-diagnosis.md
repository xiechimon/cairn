# PR #1871 CI diagnosis

The failing check is inherited from main. No product code was changed during this investigation.

## Reproduction

Command, run on the current tree under the shared heavy-check lock:

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts 2>&1 | tee docs/verify/1535/ci-roster-reproduction.txt'
```

Exit status: 1. One test passed and one failed. The installed catalogs derive 162 vendor entries; the committed snapshot contains 157 (13 ids present only in the catalogs, 8 ids present only in the snapshot; aliases unchanged). The complete local output is in `ci-roster-reproduction.txt`.

The mismatch includes additions such as `claude-haiku-5-5`, `gemini-4-argon`, and `mistral-large-4`, and removals such as `gpt-5.2-chat-latest` and `open-mixtral-8x7b`. The installed `@earendil-works/pi-ai` package reports version `1.4.0`, matching the daemon manifest and lockfile. The test reads only static catalog JSON and a checked-in constant, so the failure is deterministic, not a flake.

## Attribution

`origin/main` resolves to `0117480ad956c1b0bc6b1f5cef149fdd11a9802f`, and this lane branches directly from it: `git rev-list --count HEAD..origin/main` returns 0, so no rebase is needed. `git diff origin/main HEAD` touches only `apps/server/src/trajectory-guard-detector.ts` and evidence files under `docs/verify/1535/`; the roster test, the entire `apps/server/src/services/merge-gate` directory, `apps/daemon/package.json`, and `pnpm-lock.yaml` are identical to main. The failing assertion derives the roster from installed catalog JSON and compares it with the committed snapshot; it does not import the detector.

Main itself is red on the same test: the `check` job of run [40351380688](https://github.com/xiechimon/cairn/actions/runs/40351380688), on main commit `0117480a`, fails `test/merge-gate-model-roster.test.ts > merge-gate model roster > the checked-in snapshot matches the installed pi model catalogs` with the same 162-versus-157 assertion (361 of 362 test files passed, 5130 of 5131 tests passed). The PR run [40371990576](https://github.com/xiechimon/cairn/actions/runs/40371990576) reports the identical single failure; `pr-evidence` and all four E2E shards pass, so the PR body is not implicated.

The drift was introduced on main. `241205d7` (`daemon(1808): upgrade pi from 1.0.4 to 1.4.0`) pinned `@earendil-works/pi-ai` to `1.4.0` in the manifest and lockfile, and five commits later `0117480a` (`server(1774): compare reviewer and author models by vendor`) landed the roster snapshot test whose committed 157-entry snapshot does not match what the 1.4.0 catalogs derive. Main has been red on `check` since that commit; the fix (regenerating the snapshot from the 1.4.0 catalogs) belongs on main, not on this lane.

## Second verification

After `git fetch origin`, `origin/main` still resolves to `0117480a` and `git rev-list --count HEAD..origin/main` returns 0, so no rebase is needed and the failing inputs are unchanged. The roster assertion was reproduced again under the shared heavy-check lock (`flock /tmp/cairn-heavy.lock pnpm --filter @xiechimon/cairn exec vitest run test/merge-gate-model-roster.test.ts`); it fails the same single test with the same 162-versus-157 assertion, and the refreshed log replaced `ci-roster-reproduction.txt`.

Three checks pin the provenance of the drift:

1. The checked-in snapshot was generated from pi-ai 1.0.4. Running `deriveModelRoster` over the pristine `@earendil-works/pi-ai@1.0.4` npm tarball reproduces the checked-in `MODEL_VENDORS`/`MODEL_ALIASES` exactly (157 vendors, 3 aliases, deep-equal), while the installed 1.4.0 catalogs derive 162 vendors and mismatch. `0117480a` therefore landed a snapshot authored against the pre-upgrade catalogs that `241205d7` had already replaced in the lockfile.
2. The catalogs CI compares against are immutable and byte-identical to the local ones. `npm view @earendil-works/pi-ai@1.4.0 dist.integrity` equals the lockfile pin (`sha512-hQM/C4+1w8rHYACzDDf+0vQMnEnpzIop1tptIERVgR3ZeT/hHSzBNG8PaWPgxWQjqSeKCyBZSyp8uTT6eKK1pQ==`), and the pristine 1.4.0 tarball's `dist/providers/data` directory is byte-identical to the installed one (`diff -r` clean, and all 42 files match the package's own `.manifest.json` hashes). The failure is deterministic staleness, not a flake and not a mutated local install.
3. Main's own history shows the red/green transition. `gh run list --branch main` reports `ci` green on `10a26f29` and red on `0117480a`; the `check` check-run on `0117480a` (id 121672041735) concludes `failure`.

The fix is already in flight on another lane: PR #1861 (`lane/1855`, `server(1855): refresh the model roster snapshot from pi 1.4.0 catalogs`) is open with every check green (including `check`) and merge state CLEAN, touching `model-roster-data.ts`, `model-roster.ts`, the roster test, and `docs/lessons.md`. Once it lands on main, this lane rebases and its `check` goes green. Regenerating the snapshot on this lane as well would collide with lane/1855, so the inherited failure remains unchanged here.

## Scope

The user requested a code fix only for a branch-caused failure. The inherited roster mismatch is left unchanged. The first round updated evidence docs and the error ledger; the second round refreshed the reproduction log and added the provenance evidence (snapshot equals the pi-ai 1.0.4 tarball roster; registry tarball identity; main's red/green transition; PR #1861 as the in-flight fix). No product code, tests, or comments were added in either round. No push was performed.

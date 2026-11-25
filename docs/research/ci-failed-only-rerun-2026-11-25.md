# CI failed-only rerun prior art and measured validation (2026-11-25)

| Source | What it does | Trade-off for cairn | Evidence |
|---|---|---|---|
| GitHub Actions rerun & workflow syntax docs: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs | `gh run rerun <id> --failed` (`rerun-failed-jobs`) skips already-green jobs and increments `github.run_attempt` from `1` to `2`, starting fresh runners per failed job without preserving local disk state. Also: inside composite actions, `if: failure()` checks internal composite steps rather than the caller job's status. | Job-level skipping alone still reruns every test inside a failed matrix shard (~3-8m), so failed jobs need an explicit per-attempt artifact manifest uploaded when the caller step has `if: failure()`. | measured: read GitHub documentation and observed Attempt 1 composite skip in `45614662691` vs upload in `45621246751` |
| GitHub Actions artifacts (`actions/upload-artifact` v7.0.1 & `actions/download-artifact` v8.0.2): https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow | Artifacts uploaded under `github.run_id` persist across `run_attempt` boundaries on the same workflow run, so `attempt > 1` runners can download `failed-only-<job>-attempt-<N-1>` manifests cleanly. | Adds ~1-2s per failed job upload/download; safely degrades to full-shard execution whenever an earlier attempt crashed before uploading or produced a corrupt/mismatched manifest. | measured: observed `529B` to `110KB` artifacts uploaded in `45618660485` and restored in `45621246751` |
| Mergify CI / flaky test retry & prioritization docs: https://docs.mergify.com/ci-insights/test-retries/ | Separates automatic in-job flake retries (which mask intermittent failures unless tracked separately) from cross-attempt selective reruns and prioritizing previously failing specs on subsequent commits. | In-job silent `--retries 1` masks flaky tests and conflicts with Cairn's root-cause rule (`AGENTS.md` / fix-or-delete unstable tests). Cross-attempt `run_attempt > 1` filtering keeps Attempt 1 failure visibility intact while eliminating redundant Attempt 2 work. | measured: read Mergify documentation and installed `@playwright/test` / `vitest` CLI options |
| Playwright 1.63.0 (`LastRunReporter` in `playwright/lib/runner/index.js`) | Natively supports `--last-failed` and `--last-failed-file <path>`, storing exact failed test IDs in JSON (`{ status, failedTests }`) and filtering positional spec arguments on retry. | Requires verifying `status === 'failed' && failedTests.length > 0` before enabling `--last-failed` (passing `--last-failed` with empty/unmatched IDs exits 1 with `No tests found`). | measured: read installed `playwright@1.63.0` runner source and verified Attempt 2 `Running 1 test using 1 worker` in `45621246751` |
| Vitest 5.0.5 CLI (`vitest run --help`) | Does not ship a `--last-failed` CLI flag in `5.0.5`, but supports `--reporter=default --reporter=json --outputFile=<path>` and positional test file arguments; `pnpm test` intercepts `--reporter` unless invoked via `pnpm exec vitest run`. | Invoking `exec vitest run` when `CI_FAILED_ONLY_CURR_DIR` is active writes exact failed suite paths to `state.json` and strips `--shard` on `attempt > 1` retries so only failed files execute. | measured: ran `vitest --help`, verified `pnpm` `--reporter` interception in `45618660485`, and verified 1-file rerun in `45621246751` |
| Node 24 `node:test` (`--test-reporter`) & Go `go test -json` | Node `--test` supports parallel custom Transform reporters (`ci-node-test-reporter.mjs`) alongside `--test-reporter=spec`, and Go emits structured JSON `fail` events per package/top-level test. | Covers `gates` and `desktop-mac.yml` (`node --test`) as well as `tsnet-sidecar` (`go test`) without duplicating list maintenance; falls back to full suite on build/global errors. | measured: tested locally in `scripts/ops/ci-failed-only.test.mjs` and verified `gates` Attempt 2 skipping in `45621246751` |

## Safety boundary and architecture

1. **Same-commit retries (`github.run_attempt > 1` with matching `sha`, `runId`, `attempt - 1`, and `jobKey`)**:
   - Every passed shard is already skipped by GitHub's `rerun-failed-jobs`.
   - Within each retried job (`check-core`, `vitest-light`, `vitest-integration`, `e2e`, `e2e-affected`, `tsnet-sidecar`, `gates`, and `desktop-mac.yml`), `.github/actions/failed-only-restore` downloads `failed-only-<job>-attempt-<N-1>`, runs only checks/tests/files that failed in `attempt - 1`, and skips steps recorded `passed`.
   - Nested child test harnesses (`scripts/scrub-git-env.mjs` and `scripts/prepush.mjs:runPlan`) strip `CI_FAILED_ONLY_*` before spawning inner temp-repo subprocesses so outer CI attempt state never leaks into `prepush.test.mjs` fixtures.
   - Any missing, expired, corrupt, or non-matching manifest automatically falls back to running the full job/shard (never turning a missing manifest into a silent pass).

2. **New-commit fixes (different SHA)**:
   - Because code edits can introduce new regressions elsewhere, subsequent commits must still pass their full affected/required CI suites under `green-main`.
   - Two safe accelerators apply across commits:
     - **Additive-only `apps/web/src/i18n/en.ts` narrowing (`scripts/e2e-affected-select.mjs`)**: parses `en.ts` using TypeScript 7's `createScanner` (`typescript/unstable/ast`); when top-level preamble/exports match and every existing key keeps an identical normalized value (strictly new keys appended), `e2e:affected` avoids falling back to all `231/231` specs (while modifications, deletions, spreads, duplicate keys, or edits to `translate.ts` / `locale.ts` still run full `e2e`). Existing translation liveness and plural rules remain enforced by `apps/web/test/i18n-coverage.test.ts`.
     - **Fail-fast local preflight ordering (`scripts/ops/preflight-fast-gate.mjs`)**: caches failed Vitest files from `pnpm test:changed` in `.git/cairn-fast-gate-last-failed.json` and runs them first on the next preflight attempt so a broken fix fails in seconds instead of waiting through lint/typecheck/full `test:changed`.

## Measured live before/after validation

### 1. Live cross-attempt rerun (`preflight/probe-failed-only-20261125`, run `45621246751`)

Temporary probe commit injected four Attempt-1-only failures (`remote-host.test.ts` for `vitest-light (6)`, `machine-add-dialog.spec.ts` for `e2e-affected (4)`, `ci-failed-only.test.mjs` for `gates` + `check-core`'s `prepush --self-test`), pushed Attempt 1, then triggered `gh run rerun 45621246751 --failed`:

| Job | Attempt 1 (full shard/job) | Attempt 2 (failed-only rerun) | Scope rerun in Attempt 2 (measured from job logs) |
|---|---|---|---|
| `vitest-light (6)` | `3m 09s` (`13:13:07` -> `13:16:16`) | **`33s`** (`13:21:33` -> `13:22:06`) | `1` failed file (`apps/web/test/remote-host.test.ts`, `5 tests`, Vitest runtime **`127ms`**); `vitest-light (1..5)` skipped by GitHub |
| `e2e-affected (4)` | `7m 46s` (`13:13:07` -> `13:20:53`) | **`52s`** (`13:21:33` -> `13:22:25`) | `Running 1 test using 1 worker` (`--last-failed`, **`6.6s`** test duration); `e2e-affected (1,3)` skipped by GitHub |
| `gates` | `2m 06s` (`13:13:07` -> `13:15:13`) | **`40s`** (`13:21:33` -> `13:22:13`) | All passing gate steps printed `[failed-only] skipping ...: passed in attempt 1`; `gates-workflows` ran `1/12` files (`scripts/ops/ci-failed-only.test.mjs`) |
| `check-core` | `2m 03s` (`13:13:07` -> `13:15:10`) | `1m 58s` (`13:21:34` -> `13:23:32`) | Skipped all **`19`** passed checks inside `pnpm prepush --ci`; reran only `Prepush self-test` (`407` assertions passed) |

### 2. Additive-only `i18n/en.ts` selection narrowing

Measured via `node scripts/e2e-affected.mjs --dry-run apps/web/src/i18n/en.ts apps/web/src/resources/create-machine-dialog.tsx`:
- **Before**: `apps/web/src/i18n/` in `FULL_PATH_PREFIXES` forced **`231/231`** specs (`full-suite fallback for shared surfaces`).
- **After**: `apps/web/src/i18n/en.ts -> additive-only i18n/en.ts entries (existing copy unchanged) + a11y-axe`, selecting **`54/231`** specs (`-76.6%` specs) scoped to the touched `resources/` surface.

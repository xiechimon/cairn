# Incident 2271: why vitest-integration passed the PR and failed on main

| Question | Answer | Evidence |
|---|---|---|
| Did `vitest-integration` run on PR #2271? | Yes, in full: 67 files, 635 tests passed. | Run 41118179450, job 124277895484, on `refs/pull/2271/merge` b48daf56; `reject branch` passed in 4080 ms. |
| What failed on main? | The same `m5-web-e2e` `reject branch` test: `expect(locator).toBeVisible() failed: element(s) not found` after the 30 s expect timeout. | Run 41119618166, job 124289941524, squash 26a6a7c7e. |
| Was the code different? | No. | Squash 26a6a7c7e has tree 42ed1d757, the tree the PR run tested. |
| Was the job skipped or filtered? | No. `ci.yml` has no path filters; `has-code` was true. `check` needs `changes`, `check-core`, `vitest-light` and `vitest-integration`. | `.github/workflows/ci.yml`; `scripts/prepush.test.mjs` pins these conditions. |
| Does the deterministic test run in the integration job? | No. `apps/web/test/**` belongs to the `apps/web` project, which runs in `vitest-light`. | `vitest.config.ts` (`HEAVY_PROJECTS` is only `integration`); `apps/web/vitest.config.ts` includes `test/**/*.test.ts`. |

## Cause

#2271 added `!running` to the confirm branch of `onSend` in `apps/web/src/detail/use-detail-composer.ts`. `running` counts claimed, pending and waiting_quota steps, so request-changes feedback was sent as a steer instead of a plan revision. The integration test reaches that path only while a step is still claimed at click time, so it is timing dependent: it passed on the PR run and failed on main. Restoring `!running` locally failed the test in 2 of 2 runs.

## Guard

#2301 (263ad85c7) removed the condition and added `apps/web/test/detail-confirm-request-changes.test.ts`, a deterministic unit test that fails when `running` is true. It runs in `vitest-light`, so the regression no longer depends on integration timing.

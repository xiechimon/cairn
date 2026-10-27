# Historical token cost preservation

The startup backfill only selects rows with all five cost columns null. Any recorded cost, including a free model's five zeros or a partial cost, is preserved. Missing costs remain unknown until rates become available, and a successful backfill is stable across later restarts.

## Failure cases

- A recorded free model becomes paid.
- A recorded model loses its configured rates.
- A paid model's rates change after usage was recorded.
- Missing costs acquire rates on a later startup.
- A missing cost resolves to a free rate, followed by a paid rate.
- A partially recorded cost is mistaken for entirely missing data.
- Repeated startup backfills change recorded costs or task totals.

## Test-first evidence

The same command runs before and after the implementation:

```sh
pnpm exec vitest run apps/server/test/token-usage-cost.test.ts
```

[backfill-red.log](backfill-red.log) records three failing and three passing cases against the reviewed PR implementation. The free-to-paid case changes the recorded total from zero to 0.0642. The deleted-rate case changes it from zero to null. The missing-cost case remains null despite a configured price.

[backfill-green.log](backfill-green.log) records all six cases passing after the fix. These tests use the real server machine API and SQLite database, compare the entire persisted usage rows after pricing changes, and read the task total through the HTTP API.

## Data boundary

`token_usage` has no row timestamp or price provenance. The migration journal records migration execution, not which token usage rows were recorded before it. Therefore an existing zero cannot safely be classified as an old placeholder or a real free cost. Such zeros are preserved. Historical missing costs already represented by null can be filled. No released migration or schema is changed, and this fix cannot reconstruct costs already overwritten by earlier startups. The original data-repair goal in #1797 remains incomplete for ambiguous old zeros; #1847 fixes preservation and null-only backfill without claiming that all legacy usage is priced.

The write-time accumulation behavior in `machine-finish-step.ts` is outside this startup-backfill change.

## Upgrade evidence

`pnpm exec vitest run apps/server/test/token-usage-cost.test.ts apps/server/test/token-usage-cost-migration.test.ts` passes seven cases in two files. [backfill-upgrade-green.log](backfill-upgrade-green.log) records this run. The upgrade case applies the real migration chain through 0057, inserts rows through the old DEFAULT 0 schema, then applies 0058 and the remaining migrations. It verifies that both priced and unknown old zeros remain zero after repeated startup backfills. These legacy rows are deliberately not relabeled null to manufacture a successful repair. Ambiguous old zeros may therefore still appear as free usage; that display is not evidence that their real cost has been recovered.

## Review

The named `/code-review` and `/simplify` skills and `ai-route` are not installed in this cloud workspace. Source review and a separate agent review found no remaining blocking issue within the stated scope, including the real upgrade test. No security-sensitive authentication or command-gate path changes in this follow-up.

The independent follow-up review of merged PR #1823 requested by #1847 is still outstanding. This code fix does not complete or close the audit issue.

## Test network isolation

The first prepush found two server fixtures that let `finishStep` use the public GitHub API. `step-claim-report.test.ts` and `delivery-surface.test.ts` now inject empty branch-list responses through their existing GitHub port. The claim-report case retains its custom probe for the concurrent-claim test. No production networking or timeout changes. The claim failure is in [claim-timeout-red.log](claim-timeout-red.log), with its passing run in [claim-timeout-green.log](claim-timeout-green.log). [delivery-fetch-red.log](delivery-fetch-red.log) records the four delivery timeouts; [delivery-fetch-green.log](delivery-fetch-green.log) records all 19 cases passing across the two fixtures and the cost tests. The separate agent also reviewed these two fixture changes and found no blocking issue.

## Cloud process reaping

The complete affected Vitest run passed 174 files and 2205 tests. The final browser stage initially passed 22 cases and failed the live-server disposal case: process group 135133 contained only an orphaned zombie esbuild process (PID 135155, PPID 1, state Z). The server itself had exited. This cloud container's PID 1 did not reap it, so the unchanged process-group existence check remained true after SIGKILL.

A command-local Linux subreaper (`PR_SET_CHILD_SUBREAPER`) adopts and waits for orphaned descendants of the verification command. The existing browser tests then pass all 23 cases, including both disposal and caller-SIGKILL cases, in [subreap-e2e.log](subreap-e2e.log). No test is skipped, no timeout is increased, and no browser helper or product process code changes. Normal prepush and push hooks run under this wrapper in the cloud environment.

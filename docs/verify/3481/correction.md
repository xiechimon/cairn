# Correction classification: first retirement segment

Requirement and approved state inventory: [migration design](../../research/thread-tags-retirement-3481.md).

## Runtime evidence

`correction-live.json` records real HTTP requests against a separately started server with an isolated data directory, auth off and the in-server Coordinator disabled. All instance identifiers are replaced with stable placeholders; the observed statuses and other response values are preserved. The probe used the production server entry point, not fixture pages or a test app. The SQLite check opened that instance's database read-only.

| Clause | Observation |
| --- | --- |
| Existing generic assignment still activates correction classification during the transition | Assigning the correction category writes `correctionRequired = 1`. |
| Internal state cannot be cleared through a public todo patch | A patch carrying `correctionRequired: false` does not clear the persisted flag, and the field is absent from responses. |
| Correction completion remains guarded | The subsequent done patch returns 409 without evidence for the delivered head. |
| Ordinary threads are unaffected | An unclassified control task can complete with HTTP 200. |
| Referential integrity | `PRAGMA foreign_key_check` returns no rows. |

The runtime probe starts and stops its server through `scripts/owned-process.mjs`. It does not write to the live instance. No model or real GitHub service is exercised by the probe.

## Red-first regression

Before production edits, the three tests in `apps/server/test/correction-classification.test.ts` failed: two because the flag column did not exist, and one because no snapshot migration ran and the injected update failure never occurred.

The original targeted run passed 122 tests across six files:

```sh
pnpm exec vitest run apps/server/test/correction-classification.test.ts apps/server/test/correction-gate-binding.test.ts apps/server/test/loop-feedback.test.ts apps/server/test/github-issues.test.ts apps/server/test/orchestration-source.test.ts apps/server/test/wire.test.ts --maxWorkers=4 --no-file-parallelism
```

The regression covers fresh defaults, API invisibility, local and GitHub upgrade preservation, mixed-case classification, unchanged complete task records and label associations, classification surviving removal of the old join, repeated boot, migration rollback, imported correction issues, guard/head binding and post-merge settlement. Existing generic assignment remains a transitional input and synchronizes the flag; its retirement follows in a separate segment.

`pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` and `pnpm prepush` passed.

## Review fix: partial writes

Cloud review identified a partial-write bug: an invalid same-project replacement changed the internal correction flag and deleted associations before the request failed. The whole writer inventory was checked: creation (including GitHub import), same-project replacement and project moves. Validation and deduplication now happen before replacement writes, and Drizzle transactions keep the task, flag, associations and moved schedules atomic.

Eleven new regression cases failed before the production fix. The final regression set adds twelve cases, including a same-project fault-injection control:

| Entry path | Failure or control | Required result |
| --- | --- | --- |
| Same-project replacement | Missing ids in either order, missing-only and foreign-project ids; flag initially off and on | HTTP 400; complete task and associations unchanged |
| Replacement | Duplicate correction ids | HTTP 200; one association and classification on |
| Same-project replacement and project move | Injected association-insert failure | HTTP 500; complete task, version, flag, associations and schedule unchanged |
| Creation, shared by GitHub import | Injected association-insert failure | HTTP 500; no orphan task |

The current targeted run passes 178 tests across fourteen files with `--maxWorkers=4 --no-file-parallelism --testTimeout=120000`. It includes the previous eleven-file selection plus task metadata, archived-project writes and chief project selection. The affected Playwright selection now passes all 21 tests across six specs. Lint, typecheck and spec:parse pass.

A fresh isolated production-entry-point server also verifies all eight invalid replacement combinations, duplicate normalization, correction completion 409, ordinary completion 200 and a clean read-only SQLite foreign-key check. [Identifier-free runtime observations](atomic-correction/result.json) preserve these results without any instance ids. Database-write fault injection is covered by the API/SQLite regressions, not this live probe; no provider or real GitHub request is exercised.

## Earlier local limits

Before the review fix, the affected local e2e selection ran six specs / 21 tests twice. Each attempt passed 20 tests, but the browser exited or crashed at different points: first the feature-release retry test, then the already-authenticated login test. Those earlier attempts did not establish a pass; the review-fix rerun above does. CI must still report on the pushed head. The initial parallel Vitest attempt also lost a worker; serial file execution passed the entire targeted selection.

## Upgrade after the evidence-store migration

After #3612 merged, the upgrade fixture starts at main's `0136_evidence_store`. Keeping the previous correction timestamp reproduced a silently skipped migration: the upgrade had no `correctionRequired` column, the rollback probe never ran, and the journal-order regression rejected the stale entry. The correction-specific ordering check also rejected reserved number 0140 where 0137 was required.

The migration and generated snapshot are now 0137, with timestamp `1794244850529`, greater than main's maximum `1794241498270`. The supplied evidence-store regression fix checks that its migration has a predecessor instead of requiring it to remain the last entry. All 135 targeted tests in eleven files pass, including correction upgrade/rollback, evidence-store migration, journal order, staged boot, browser migration, coordinator-turn migration and core correction/GitHub/task regressions. Lint, typecheck and spec:parse pass.

On the clean replacement tree, 129 of 135 targeted tests passed within the default budget; six file-backed migration cases timed out under local disk contention without an assertion failure. Rerunning the six migration files with `--maxWorkers=4 --no-file-parallelism --testTimeout=120000` passed all 17 tests. CI configuration and assertions are unchanged. Staged public-content, lint, typecheck, spec:parse and prepush pass.

The original PR #3655 was blocked by the history-level public-content gate because its first commit included raw identifiers from the isolated scratch server. The coordinator authorized a clean replacement branch from main, carrying the final implementation as one commit with placeholder-only evidence. The replacement does not carry the rejected commit history. No gate/allowlist change, hook bypass or force push is used; fresh CI and cloud review are required on the replacement head.

No UI layout, provider execution, GitHub label storage migration or final generic-tag deletion is claimed by this segment. The generic tag routes and data still exist until the later retirement segments. The final retirement red tests are intentionally not part of this intermediate PR.

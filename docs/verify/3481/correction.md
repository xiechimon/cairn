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

The final targeted run passed 122 tests across six files:

```sh
pnpm exec vitest run apps/server/test/correction-classification.test.ts apps/server/test/correction-gate-binding.test.ts apps/server/test/loop-feedback.test.ts apps/server/test/github-issues.test.ts apps/server/test/orchestration-source.test.ts apps/server/test/wire.test.ts --maxWorkers=4 --no-file-parallelism
```

The regression covers fresh defaults, API invisibility, local and GitHub upgrade preservation, mixed-case classification, unchanged complete task records and label associations, classification surviving removal of the old join, repeated boot, migration rollback, imported correction issues, guard/head binding and post-merge settlement. Existing generic assignment remains a transitional input and synchronizes the flag; its retirement follows in a separate segment.

`pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` and `pnpm prepush` passed.

## Limits

The affected local e2e selection ran six specs / 21 tests twice. Each attempt passed 20 tests, but the browser exited or crashed at different points: first the feature-release retry test, then the already-authenticated login test. These runs do not establish an e2e pass; CI must report on the pushed head. The initial parallel Vitest attempt also lost a worker; serial file execution passed the entire targeted selection.

## Upgrade after the evidence-store migration

After #3612 merged, the upgrade fixture starts at main's `0136_evidence_store`. Keeping the previous correction timestamp reproduced a silently skipped migration: the upgrade had no `correctionRequired` column, the rollback probe never ran, and the journal-order regression rejected the stale entry. The correction-specific ordering check also rejected reserved number 0140 where 0137 was required.

The migration and generated snapshot are now 0137, with timestamp `1794244850529`, greater than main's maximum `1794241498270`. The supplied evidence-store regression fix checks that its migration has a predecessor instead of requiring it to remain the last entry. All 135 targeted tests in eleven files pass, including correction upgrade/rollback, evidence-store migration, journal order, staged boot, browser migration, coordinator-turn migration and core correction/GitHub/task regressions. Lint, typecheck and spec:parse pass.

On the clean replacement tree, 129 of 135 targeted tests passed within the default budget; six file-backed migration cases timed out under local disk contention without an assertion failure. Rerunning the six migration files with `--maxWorkers=4 --no-file-parallelism --testTimeout=120000` passed all 17 tests. CI configuration and assertions are unchanged. Staged public-content, lint, typecheck, spec:parse and prepush pass.

The original PR #3655 was blocked by the history-level public-content gate because its first commit included raw identifiers from the isolated scratch server. The coordinator authorized a clean replacement branch from main, carrying the final implementation as one commit with placeholder-only evidence. The replacement does not carry the rejected commit history. No gate/allowlist change, hook bypass or force push is used; fresh CI and cloud review are required on the replacement head.

No UI layout, provider execution, GitHub label storage migration or final generic-tag deletion is claimed by this segment. The generic tag routes and data still exist until the later retirement segments. The final retirement red tests are intentionally not part of this intermediate PR.

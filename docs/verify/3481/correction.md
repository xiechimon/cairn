# Correction classification: first retirement segment

Requirement and approved state inventory: [migration design](../../research/thread-tags-retirement-3481.md).

## Runtime evidence

`correction-live.json` records real HTTP requests against a separately started server with an isolated data directory, auth off and the in-server Coordinator disabled. The probe used the production server entry point, not fixture pages or a test app. The SQLite check opened that instance's database read-only.

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

No UI layout, provider execution, GitHub label storage migration or final generic-tag deletion is claimed by this segment. The generic tag routes and data still exist until the later retirement segments. The final retirement red tests are intentionally not part of this intermediate PR.

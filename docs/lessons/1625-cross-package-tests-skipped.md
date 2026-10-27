---
Category: After adding project routes and record fields, only the owning package's tests were run; the live vocabulary registration and the wire snapshot only went red at push time
Source: #1625 (2026-10-25)
Level: 2
Safeguard: `node scripts/prepush-vitest.mjs` picks affected vitest files by changed paths, including the `wire.test.ts` vocabulary registration and the `snapshot.test.ts` snapshot; run it before committing too
Intercepts: 3
Recurrences: 2
Notes: Negative control: with the `merge-policy` route unregistered the vocabulary test reports an invented route; with the snapshot unupdated the project snapshot reports a missing field; green after registering and updating. Also: `vitest -u <file>` runs the full suite on this machine, so when updating a snapshot, first confirm the failure without -u and then run the single file. #1905 recurrence: two new `ENV_VARS` entries in `brand.ts` were committed without running the paired `vocabulary.test.ts` deep-equal and snapshot, so CI's `check` went red on both; destructure-and-assert the new keys plus regenerating the snapshot turned green, and the affected set now runs before push #1794 recurrence (2026-10-26): the unregistered GET /api/builds/{id}/gate route failed wire.test.ts; adding it to INFERRED_ROUTES made the same check pass.
---

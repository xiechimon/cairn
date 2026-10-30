---
Category: Fixture relationship data shape differed from production writes and concealed a restore drill defect
Source: #2190 (2026-10-30)
Level: 2
Safeguard: Migrated schema with typed relationship inserts and the server message insert helper plus build-scoped positive and missing-child negative controls; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: relationships-red.log rejects the old step-scoped lookup with build-scoped messages. Server write-path audit covers todo to build, build to step, build to message and chief thread to message. String identifiers cannot express relational ownership in types alone.
---

Merged related control history:

relationships-boundary-fixture-error.log records the discarded test error; the drill correctly accepted a post-backup row. The corrected test requires a row at the actual cutoff.

The new chief route read exposed an older raw-SQL content edit that wrote invalid JSON into a JSON-mapped column. The fixture now stores the same encoded string as the typed insert; the full suite failure remains in green.log.

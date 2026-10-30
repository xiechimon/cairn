---
Category: Fixture relationship data shape differed from production writes and concealed a restore drill defect
Source: #2190 (2026-10-30)
Level: 2
Safeguard: Migrated schema with typed relationship inserts and the server message insert helper plus build-scoped positive and missing-child negative controls; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: relationships-red.log rejects the old step-scoped lookup with build-scoped messages. Server write-path audit covers todo to build, build to step, build to message and chief thread to message. String identifiers cannot express relational ownership in types alone.
---

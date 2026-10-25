---
Category: A new test fixture missed required fields or the foreign-key parent row and never entered the path under test
Source: #1513 (2026-10-23)
Level: 2
Safeguard: `build-provenance.test.ts` first asserts that creating a build returns 201; the old-database migration builds data through real foreign-key chains
Intercepts: 2
Recurrences: 0
Notes: negative control: creating a build fails without the spec, and SQLite rejects the insert without the todo parent row; migration and feedback tests pass once filled in
---

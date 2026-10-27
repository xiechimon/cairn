---
Category: New test fixtures missed a required field or the foreign-key parent row and never entered the path under test
Source: #1513 (2026-10-23)
Level: 1
Safeguard: Drizzle insert types require mandatory fields; server typecheck checks test fixtures, and SQLite enforces parent rows before the behavior assertions
Intercepts: 4
Recurrences: 2
Notes: #1847 upgrade fixture first omitted provider.compat and failed its NOT NULL constraint before migration/backfill; supplying the required typed field reaches the intended boundary assertions. #1829 initially omitted step.createdAt: SQLite rejected the fixture before finishStep ran. Supplying the required timestamp reached the intended red assertions, and server typecheck passed. Existing API creation tests assert 201 and migration fixtures follow real foreign-key chains.
---

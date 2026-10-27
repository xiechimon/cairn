---
Category: Startup cost backfill treated recorded free usage as unresolved legacy data, and unchanged-rate tests missed the historical-cost rewrite
Source: #1847, PR #1873 (2026-10-27)
Level: 2
Safeguard: token-usage-cost.test.ts on PR #1873 records usage through the machine API, changes or deletes pricing, and asserts every SQLite cost field and task total stays unchanged; missing-cost tests cover later pricing and repeated backfills
Intercepts: 3
Recurrences: 0
Notes: Negative control on PR #1873: the reviewed zero-only guard fails both free-model pricing changes and the missing-cost case in docs/verify/1847/backfill-red.log; all six cases pass after selecting only rows with five null cost columns. Ambiguous historical zeros remain recorded because the schema has no reliable provenance. The cost regression implementation and acceptance belong to PR #1873
---

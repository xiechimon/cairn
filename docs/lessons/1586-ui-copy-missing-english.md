---
Category: New UI copy shipped without the English entry
Source: #1586 (2026-10-24)
Level: 2
Safeguard: the existing `i18n-coverage.test.ts` scans all `t` literals and checks them against EN
Intercepts: 1
Recurrences: 0
Notes: real negative control: the coverage check went red when the orchestration-failure entry was missing; green after adding the entry, no duplicate gate created
---

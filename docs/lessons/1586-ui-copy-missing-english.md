---
Category: New UI copy missed the English entry
Source: #1586 (2026-10-24)
Level: 2
Safeguard: The existing `i18n-coverage.test.ts` scans all t literals and checks them against EN
Intercepts: 1
Recurrences: 0
Notes: Real negative control: coverage goes red when the orchestration-failure entry is missing; green after adding the entry; no duplicate gate is built
---


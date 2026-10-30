---
Category: A new admission table was omitted from the shared table registry and invalidated a historical upgrade fixture
Source: #1405 (2026-10-30)
Level: 2
Safeguard: The existing schema-to-registry equality test and explicit internal-table assertion check registration; upgrade fixtures now migrate genuine prior journals before applying the current journal
Intercepts: 0
Recurrences: 0
Notes: review-1-table-registry-red.log records both original failures and review-1-internal-registry-red.log records the missing internal registration. The corrected upgrade test retains historical migration records rather than deleting an earlier row beneath a newer migration.
---

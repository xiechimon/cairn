---
Category: A rebased push migration retained a timestamp older than the preceding main migration
Source: #1686 (2026-10-27)
Level: 2
Safeguard: The schema test simulates an already migrated database and runs the real Drizzle migrator before selecting both new tables
Intercepts: 1
Recurrences: 0
Notes: Negative control failed with no such table: push_subscription; advancing only the push migration timestamp makes it pass
---

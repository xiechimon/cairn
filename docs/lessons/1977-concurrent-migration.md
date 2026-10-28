---
Category: Concurrent coordinator constructors raced when running database migrations
Source: Issue #1977 (2026-10-28)
Level: 1
Safeguard: Server database initialization owns migrations and coordinators only connect to an already migrated database
Intercepts: 0
Recurrences: 0
Notes: The independent-process lifecycle test failed with table agent already exists before migration ownership was separated
---

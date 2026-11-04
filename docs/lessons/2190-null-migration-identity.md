---
Category: Restore comparison rejected clean Drizzle migrations because declared primary keys were null
Source: Ticket 2190 (2026-10-30)
Level: 2
Safeguard: Migrated-schema fixture and migration hash corruption regression; migration ledger uses explicit SQLite rowid identity
Intercepts: 0
Recurrences: 0
Notes: The clean fixture failed with duplicate primary key before the fix; implementation-red.log preserves the negative control. External migration schema cannot be constrained by this ops script.
---

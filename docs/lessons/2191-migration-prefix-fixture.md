---
Category: An upgrade regression replayed an older migration against a database already at a newer tip
Source: Ticket #2191 (2026-10-30)
Level: 1
Safeguard: Construct the upgrade fixture from the actual journal prefix before applying the current journal; no hardcoded migration tag or artificial column drop remains
Intercepts: 0
Recurrences: 0
Notes: Adding migration 0069 exposed the existing fixture deleting the 0068 ledger row while 0069 remained applied; the old assertion failed. The replacement migrates a fresh SQLite database through the penultimate migration, seeds it, applies the tip and verifies data preservation and push delivery access.
---

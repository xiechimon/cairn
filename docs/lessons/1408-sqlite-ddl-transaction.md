---
Category: Drain setup left a partial state table after an SQLite trigger creation error
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: Drain explicitly begins an immediate transaction before DDL and a regression injects a duplicate trigger to assert complete rollback
Intercepts: 0
Recurrences: 0
Notes: drain-transaction-red.log records the original partial-table failure; a connection context manager alone did not begin a transaction before CREATE TABLE. Green output is in green.log.
---

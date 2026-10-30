---
Category: A read-only SQLite connection changed the live WAL shared-memory sidecar
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: The pause guard uses the Unix no-lock VFS in exclusive read-only mode and a real uncheckpointed WAL regression compares DB and both sidecars byte for byte
Intercepts: 0
Recurrences: 0
Notes: wal-red.log captures mode=ro modifying the shared-memory bytes. The guard uses a private in-process WAL index instead; no schema or data mutation is performed. Concurrent external schema changes remain outside fixture acceptance.
---

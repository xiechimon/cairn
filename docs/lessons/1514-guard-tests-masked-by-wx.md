---
Category: Guard tests were masked by another mechanism: the export write uses `wx`, so an existing target necessarily gives EEXIST; after deleting the source-path guard, the three tests "refuses to overwrite the source database", "symlinked parent directory", and "invalid selector does not replace output" all stayed green
Source: #1514 (2026-10-24)
Level: 2
Safeguard: The guard tests first delete -wal/-shm so the target is a not-yet-existing path and assert the guard's own error text `Output must not overwrite the database`; an existing --out has a dedicated test asserting the `Output already exists` text; the invalid-selector test now asserts the output file was not created
Intercepts: 1
Recurrences: 0
Notes: Negative control: with the realpath guard deleted, all five guard tests (direct writes to server.db / -wal / -shm, and server.db / -wal through a symlink) go red, green again after restoring it
---


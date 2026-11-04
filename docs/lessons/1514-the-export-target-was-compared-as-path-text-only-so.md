---
Category: The export target was compared as path text only, so a symlinked parent directory could bypass the source-database protection
Source: #1514 (2026-10-24)
Level: 1
Safeguard: The exporter compares the target path under the real parent directory against the database and WAL/SHM paths; a real sqlite-command test covers symlinked parent directories
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old text comparison allowed alias/server.db to replace the test source database; the real-path comparison rejects it and the database bytes are unchanged
---

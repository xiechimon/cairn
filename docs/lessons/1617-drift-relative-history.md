---
Category: Deleted relative documentation paths were missed because HEAD and historical lookup used different path resolution
Source: #2023 repair of #1617 (2026-10-28)
Level: 2
Safeguard: Tests in `scripts/doc-drift.test.mjs` require historical suffix lookup, exact directory boundaries and HEAD-only behavior; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: The unchanged original #2023 implementation returns an empty list for both deletion controls in relative-history-red.log. The repaired CLI returns the exact documented names and lines.
---

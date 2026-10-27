---
Category: Boundary tests passed when Node failed before attempting the target read
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: External sentinel tests require a denied event containing the target path, run wherever Linux x86_64 with gcc and ldd is present, and grading fails closed on every other platform
Intercepts: 2
Recurrences: 0
Notes: read-target-red.log records both Node cases failing the stronger assertion before runtime handling was fixed
---

---
Category: Subprocess boundary tests hard-failed on platforms and toolchains they cannot run on
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: The suite skips real-process controls unless Linux x86_64 with gcc and ldd is present, and cross-platform cases assert fail-closed grading; executeBounded returns enforced false on unsupported platforms
Intercepts: 0
Recurrences: 0
Notes: The review round caught it before merge; the 1985-runtime-probe-grading, 1985-target-read-audit and 1985-untraced-child-audit safeguards were updated to state their platform scope
---

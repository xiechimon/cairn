---
Category: A new shared motion path list was omitted from the merge gate freeze set
Source: Issue #1783 (2026-10-27)
Level: 2
Safeguard: The existing merge-gate-imports regression rejects unfrozen exported arrays and objects
Intercepts: 1
Recurrences: 0
Notes: The real MOTION_TOKEN_PATHS omission failed the invariant; adding the list to the existing freeze set passes
---

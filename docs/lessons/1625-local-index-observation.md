---
Category: A cleanliness probe refreshed the user's index on an otherwise untouched alternate branch
Source: #1625 (2026-10-27)
Level: 2
Safeguard: The alternate-branch test changes file timestamps and compares index bytes before and after landing; cleanliness probes set GIT_OPTIONAL_LOCKS=0
Intercepts: 1
Recurrences: 0
Notes: Ordinary git status changes index stat-cache bytes and fails the assertion; disabling optional locks preserves the entire index
---

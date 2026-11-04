---
Category: Normalizing bound text removed significant bytes from Git patches and local check commands
Source: #1625 (2026-10-27)
Level: 1
Safeguard: The patch collector uses raw Git output instead of the normalizing wrapper; the command schema validates nonblank text without a transforming schema operator; independent tuple and exact-command regression tests cover both boundaries
Intercepts: 1
Recurrences: 1
Notes: The old runGitOk-based reader fails the trailing-space patch SHA assertion; reading raw stdout and removing only Git's terminal newline passes. The protocol regression rejects the former trimming schema because command bytes no longer match the judged configuration
---

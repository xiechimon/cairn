---
Category: Commit preparation inherited bot identity despite configured user identity
Source: Issue #2093 (2026-10-28)
Level: 2
Safeguard: Execute the documented recipe with inherited bot author and committer variables and inspect both identities in the resulting Git commit
Intercepts: 0
Recurrences: 0
Notes: The old configuration-only recipe fails the executable regression; explicit environment assignments pass all three inherited identity scenarios
---

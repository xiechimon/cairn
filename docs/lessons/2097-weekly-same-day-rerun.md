---
Category: Weekly eval re-run re-recorded flows then failed on an existing review directory
Source: Issue #2097 (2026-10-28)
Level: 1
Safeguard: Check reviews/<day>/ before creating the eval worktree or running flows; exit as a no-op when it exists
Intercepts: 1
Recurrences: 0
Notes: Pair with requiring labeler env before a zero-pack review and default traj:export/traj:label into eval:sample-failures
---

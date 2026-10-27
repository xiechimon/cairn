---
Category: Pushing a detached HEAD to a new abbreviated destination failed before creating the remote branch
Source: PR #1906 evidence publication (2026-10-28)
Level: 2
Safeguard: Git rejects an ambiguous new destination; use the complete refs/heads/codex/1906-evidence destination for a detached checkout
Intercepts: 1
Recurrences: 0
Notes: The initial HEAD:codex/1906-evidence push failed with the full-refname diagnostic and wrote no remote ref; the corrected destination is explicit
---

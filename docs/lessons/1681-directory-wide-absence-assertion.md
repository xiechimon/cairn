---
Category: A negative-control test asserted that a file an open sibling PR adds was absent from the whole shared directory (`integration/eval/harbor/`), so the assertion would go red on main the moment that PR merged
Source: #1681 (2026-10-26)
Level: 2
Safeguard: The assertion now lists only the offline-oracle task's own `environment/` dir, so sibling PR files cannot trip it; before asserting directory-wide absence, list open PRs touching that directory
Intercepts: 1
Recurrences: 0
Notes: The red state only materializes after PR #1885 merges `host-network.compose.yaml`; the scoped assertion stays green with or without it
---

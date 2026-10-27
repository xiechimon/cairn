---
Category: A fixup commit was created with `--no-verify` to skip the pre-commit hook, breaking the never-bypass rule; self-review caught it seconds later, the commit was soft-reset and recreated through the hooks
Source: PR #1678 rebase (2026-10-25)
Level: 3
Safeguard: The hook gates name their own explicit env-var exits (lockfile, banned vocab) and offer no other bypass; the discipline is to read the command before running it, not to reach for `--no-verify` under time pressure
Intercepts: 0
Recurrences: 0
Notes: No harm done — the redo ran the hooks and passed; the banned-vocab and lockfile gates were not even implicated
---


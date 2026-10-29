---
Category: Completion closure reused cancellation semantics and accepted conflicting or stale ownership evidence
Source: Issue 1962 (2026-10-29)
Level: 2
Safeguard: Regression tests assert the PATCH reason and reject contradictory observations and claims arriving during reads
Intercepts: 0
Recurrences: 0
Notes: The existing branch fails all three regression assertions in docs/verify/1962/red.log; the fix passes them without changing legacy callers
---

---
Category: Squashing against a shared moving remote ref staged reversals of upstream changes
Source: PR #1828 original implementation (2026-10-26)
Level: 2
Safeguard: The pre-commit vocabulary gate blocked the original reverse-diff commit; review the staged diff against the captured merge base before squashing
Intercepts: 1
Recurrences: 0
Notes: This records the original lane incident. The current reconciliation uses a normal merge and keeps all main changes; shared remote refs can move when another worktree fetches
---

---
Category: Evidence docs committed on a lane spelled out the lane head SHA in full; the squash that folded the lane's commits left the reference dangling, so a fresh clone cannot resolve it without the authoring worktree's reflog
Source: #1871 (2026-10-26)
Level: 3
Safeguard: Evidence docs describe the lane by its relation to `origin/main` (branch point, `git rev-list --count HEAD..origin/main`) and cite Actions run/job URLs; full SHAs appear only for main commits, which a lane cannot rewrite
Intercepts: 0
Recurrences: 0
Notes: A docs gate that fails on unresolvable 40-hex SHAs is feasible but needs an allowlist for historical SHAs quoted in specs and the ledger; promote it if the category recurs
---


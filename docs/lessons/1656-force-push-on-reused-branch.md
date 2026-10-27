---
Category: A PR on the branch had merged; after re-cutting the same branch name from main, pushed with `git push -f`, violating AGENTS.md "never --force push"
Source: Claude thread "Learning poteto's high-output PR methods" (2026-10-24)
Level: 5
Safeguard: Memory: when reusing an already-merged branch, push under a new branch name, never force-push
Intercepts: 0
Recurrences: 0
Notes: This time only the commits already squashed into main were overwritten, nothing was lost; the pre-push hook can detect non-fast-forward pushes, kept as an upgrade candidate
---


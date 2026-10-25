---
Category: A previous PR from the branch had been merged; after re-cutting the same branch name from main, `git push -f` was used, breaking AGENTS.md "never force push"
Source: Claude thread "learning from poteto's high-output PR method" (2026-10-24)
Level: 5
Safeguard: memory: when reusing an already-merged branch, push under a new branch name instead of force-pushing
Intercepts: 0
Recurrences: 0
Notes: this time only the commits already squashed into main were overwritten, nothing was lost; a pre-push hook can judge non-fast-forward pushes and stays a candidate for an upgrade
---

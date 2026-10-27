---
Category: `git commit ... \| tail -1` swallowed a pre-commit hook failure on a merge commit; the follow-up `git push` reported `Everything up-to-date` and the PR stayed in conflict
Source: menu surfaces thread (2026-10-26)
Level: 5
Safeguard: memory: never pipe `git commit` into `tail` or `grep`; check `git log -1` and `.git/MERGE_HEAD` before pushing a merge
Intercepts: 0
Recurrences: 0
Notes: agent-side shell habit; the push itself was correct for the tree it saw
---

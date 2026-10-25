---
Category: A new script test set cwd to the real repo (`process.env.PWD`) and `git rm`-ed a baseline file; the real repo's `scripts/lint-warning-baseline.json` was deleted from the staging area
Source: #1617 (2026-10-24)
Level: 2
Safeguard: `scripts/baseline-ratchet-gate.test.mjs` compares the real repo's `git status --porcelain -- scripts` before and after; a test may only touch its own throwaway repo
Intercepts: 1
Recurrences: 0
Notes: negative control: first adding a case that `git rm`s the baseline in the real repo turned the after hook red with "tests must only touch their own throwaway repos"; removing the case restored the file and turned green
---

---
Category: The newly written script test set cwd to the real repo (`process.env.PWD`) and ran `git rm` on a baseline file; the real repo's `scripts/lint-warning-baseline.json` was removed from the staging area
Source: #1617 (2026-10-24)
Level: 2
Safeguard: `scripts/baseline-ratchet-gate.test.mjs` compares the real repo's `git status --porcelain -- scripts` in before/after hooks; tests may only touch their own throwaway repos
Intercepts: 1
Recurrences: 0
Notes: Negative control: adding a case that `git rm`s a baseline in the real repo makes the after hook report "tests must only touch their own throwaway repos" red; removing that case restores the file and turns green
---

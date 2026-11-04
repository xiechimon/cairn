---
Category: The pre-push hook ran its checks with the hook-exported `GIT_DIR`, so `reach.test.mjs` running `git init` in a tmpdir landed in the real repo and rewrote the shared config to `core.bare=true` — every worktree then reported "not a work tree"
Source: #1429 (2026-10-25)
Level: 2
Safeguard: `scripts/prepush.mjs` scrubs `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` and the other repo-location vars from every check child via `scripts/scrub-git-env.mjs`, so all checks inherit a clean environment
Intercepts: 0
Recurrences: 0
Notes: Negative control: in a mktemp repo with a worktree, `GIT_DIR=<worktree gitdir> node --test docs/verify/1542/reach.test.mjs` flipped that repo's `core.bare` from false to true; after the fix a real `git push` hook run kept `core.bare` false
---

---
Category: Pushes from a fresh worktree ran no pre-commit or pre-push hook: `core.hooksPath` is the relative `.husky/_`, and the worktree was installed with `--ignore-scripts`, so `.husky/_` did not exist and CI was the first place the English-only, single-use-helper and format gates ran
Source: #1713 push (2026-10-25)
Level: 3
Safeguard: AGENTS.md "Worktrees": run `pnpm exec husky` in a new worktree and check `.husky/_/pre-push` exists
Intercepts: 0
Recurrences: 0
Notes: a hook cannot report its own absence; CI runs the same gates through `pnpm prepush --ci`
---

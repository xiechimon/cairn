---
Category: Pushes from a fresh worktree ran no pre-commit or pre-push hook: `core.hooksPath` is the relative `.husky/_`, the worktree was installed with `--ignore-scripts`, so `.husky/_` did not exist and CI was the first place the English-only, single-use-helper and format gates ran
Source: #1713 push (2026-10-25)
Level: 3
Safeguard: AGENTS.md "Worktrees": run `pnpm exec husky` in a new worktree and check `.husky/_/pre-push` exists; never symlink `node_modules` from the main checkout (the pre-commit task runner refuses a symlinked state directory) and never commit with `core.hooksPath=/dev/null` to get past that, install with `pnpm install --frozen-lockfile --offline` instead
Intercepts: 0
Recurrences: 1
Notes: A hook cannot report its own absence; CI runs the same gates through `pnpm prepush --ci`; recurred 2026-10-26 (home PR): a worktree with symlinked node_modules failed the hook, and one WIP commit went in with hooks off; the next commit ran the full pre-commit after a real install
---

---
Category: Running pnpm exec husky in a fresh worktree triggered pnpm's automatic install and dependency lifecycle scripts without authorization
Source: #1845 (2026-10-27)
Level: 3
Safeguard: Install dependencies with pnpm install --ignore-scripts before invoking pnpm commands in a fresh worktree; initialize hooks afterward and verify .husky/_/pre-push
Intercepts: 0
Recurrences: 0
Notes: Negative control: the initial pnpm exec husky output shows automatic installation and dependency lifecycle scripts; inspect the worktree dependencies before running pnpm
---

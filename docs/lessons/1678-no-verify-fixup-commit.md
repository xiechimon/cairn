---
Category: A commit or push skipped the repository git hooks (`--no-verify`, or `-c core.hooksPath=/dev/null`), breaking the never-bypass rule
Source: PR #1678 rebase (2026-10-25); #2182 probe branch (2026-10-30)
Level: 2
Safeguard: The owner's Claude Code PreToolUse hook `~/.claude/hooks/dangerous-cmd-block.local.cjs` blocks `--no-verify`, `git commit -n`, `-c`/`--config-env core.hooksPath=…`, `HUSKY=0` and `GIT_CONFIG_KEY_n=core.hooksPath` on commit, push, merge, am, rebase, cherry-pick and revert, changes to `core.hooksPath` through `git config`, and checkouts with hooks off. The only exceptions are pr-gate's `checkout --detach` in its own linked worktree and its hooks-off fetch and update-ref; since 2026-10-30
Intercepts: 0
Recurrences: 1
Notes: #1678: a fixup commit used `--no-verify`, was soft-reset and recreated through the hooks. #2182: the throwaway branch `probe/2182-env-deny` was committed and pushed with `git -c core.hooksPath=/dev/null`; it never merged and was deleted. Negative control: the hook's test file `~/.claude/hooks/dangerous-cmd-block.local.test.cjs` fails 23 cases against the previous hook, including the exact #2182 commands, and passes all 37 after the change. Level 1 is not available: the hook lives on the owner's machine and covers Claude Code sessions only, not Codex or pi lanes, and the repository cannot stop a local `git` invocation.
---

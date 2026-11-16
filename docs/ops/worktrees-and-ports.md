# Worktrees, ports and heavy slots

Rules for running stacks, tests and worktrees side by side on one host.

- Do not set `TMPDIR` without `CAIRN_HEAVY_SLOTS_DIR`; all lanes must share the heavy-work slot directory.
- Branch from `origin/main`. Create worktrees from the main checkout using absolute paths: `git worktree add "$(git rev-parse --show-toplevel)/.claude/worktrees/<name>" <branch>`.
- Run `pnpm exec husky` in a new worktree before its first commit, and verify `.husky/_/pre-push` exists.
- `E2E_PORT` defaults to 8399; check `lsof -iTCP:8399` before use. If occupied, choose another port and leave its owner running.
- Every Vitest and Playwright configuration waits for a shared heavy slot before workers or webServer builds start, including direct package-local commands and task workspaces. `CAIRN_HEAVY_SLOTS` defaults to 2; `CAIRN_HEAVY_SLOTS_DIR` selects the shared directory. CI bypasses only when that directory is absent. Waiting output names holder pid and cwd; dead holders are reclaimed. Keep Python 3 available for admission, and never delete active slot guard files.
- `e2e:affected` delegates admission to Playwright. Its port base is 8398 (direct Playwright: 8399), with stride 10 per slot; `E2E_AFFECTED_PORT` changes the affected base and `E2E_PORT` overrides the base. The configuration selects the leased slot's build directory. Inspect any reported port holder before retrying.
- Run only one Playwright instance per worktree; shared build output and ports are exclusive. Separate worktrees keep their own build outputs.
- Dev ports default to 5173 and 8787; use `CAIRN_DEV_WEB_PORT` and `CAIRN_DEV_SERVER_PORT` for another stack.
- Start any server, stack or loop that must outlive one command as a background task through `node scripts/owned-process.mjs -- <command>`; it dies with its owner. Never use `nohup`, `setsid`, `disown` or a trailing `&`; `scripts/spawn-ownership.test.mjs` rejects `detached` or `unref()` children outside the helper.
- The host's worktree reaper removes a clean worktree no process uses, wherever it lives, once its PR is merged or closed at the tree's exact head, or once it has been idle 3 days with its HEAD on a remote branch. It keeps trees under `~/.t3` and trees that hold another worktree, and reports every tree it keeps. Push work you want to survive. Each run also fast-forwards the main checkout to `origin/main` when it is on `main` with no tracked changes; worktree sessions load project skills from it, so do not leave it on another branch or with edits.

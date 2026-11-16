# Cairn Development Rules

## Safety

- This repository is public: never commit secrets, credentials, internal addresses, personal information or quota details.
- Never force push, use `--no-verify`, bypass hooks with `core.hooksPath`, or run `git reset --hard`, `git clean`, `git stash` or `git checkout .`. Never overwrite uncommitted work you did not write.
- Stage only your own changes with explicit paths; never use `git add -A` or `git add .`.
- Commit identity: agents on a host with the App key commit and push as the App (`~/.cairn/tools/app-token/as-bot.sh git ...`); a Claude Code cloud session commits as `Claude <noreply@anthropic.com>`; only commits ian types himself carry his identity. `packages/shared/commit-identity.json`, the hooks and the `commit-author` check enforce this.
- Do not run postinstall scripts without explicit user authorization; install dependencies with scripts disabled unless authorized.
- Seams: read the comments in `biome.json` before changing locked imports (`@earendil-works/*`, `@modelcontextprotocol/sdk`, `simple-git`, `isomorphic-git`, `cron-parser`) and consume them through thin bridges. Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; the exceptions are the in-server Coordinator runtime, `apps/server/src/coordinator/runtime/`, and the MCP connector client in `apps/server/src/services/mcp-servers.ts`.
- Never kill another lane's processes; inspect the PID, command and working directory before stopping a process you started. Shared ports, heavy slots and worktree rules: `docs/ops/worktrees-and-ports.md`.
- No change may edit what judges it: `integration/eval/**`, `.claude/hillclimb/**`, the trajectory exporter, its outcome fields and the pack schema (the eval globs in `packages/shared/merge-gate-paths.json`).
- Before pushing a change to a security surface, run `/security-review` and fix confirmed findings; name any finding you leave unfixed, with its reason, in the commit message.

Security surfaces (the `credentials`, `machineAndCommandBoundary` and `externalEntryAuth` lists in `packages/shared/merge-gate-paths.json`; `apps/server/test/merge-gate-paths-json.test.ts` fails when this list differs):

- Keys and encryption: `apps/server/src/lib/{secret-box,keys,token-auth,attachments-token}.ts`, `apps/server/src/services/{secrets,credentials,api-keys,oauth}.ts`, `apps/server/src/coordinator/{credentials,codex-login}.ts`
- Machine registration and dispatch protocol: `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts`, `apps/daemon/src/{credentials,secret-channel,machine-client}.ts`, `apps/daemon/src/backend/command-gate.ts`
- MCP auth and external entry points: `apps/server/src/services/{mcp-face,mcp-servers}.ts`

## Ship

Work lands on `main` directly. There is no pull request, merge queue or PR-body format. Production safety lives in the deploy: `scripts/ops/deploy-watch.sh` deploys only main commits whose `check`, `pack-smoke` and `e2e-gate` runs are green, with a migration rehearsal, a backup and rollback.

1. Work in your own worktree on a branch from the latest `origin/main`.
2. Commit any uncommitted changes. Tidy noisy intermediate commits into a few clear ones while they are still unpushed.
3. `git fetch origin main` and rebase onto the latest `origin/main`; resolve conflicts. If the rebase floods add/add conflicts in unrelated files, the clone is shallow: run `git rebase --abort`, `git fetch --quiet --unshallow origin main`, then rebase again.
4. Verify once: `pnpm prepush`, `pnpm exec vitest run --changed origin/main`, `pnpm --filter @cairn/web e2e:affected`, and `/security-review` when a security surface changed. The full suites run in CI after the push.
5. Push without force: `git push origin HEAD:main`.
6. If the push is rejected because `origin/main` is ahead, fetch, rebase and push again. Do not repeat step 4 after a later fetch, rebase or rejected push unless conflict resolution or other local edits changed files after it passed.
7. A conflict that changes behavior: resolve it, then stop and ask ian before pushing.
8. Watch CI on the commit you pushed. If it goes red, fixing it is your next task; if you cannot fix it quickly, revert your commit. While main is red, do not push on top of the broken area.
9. A failing test is not yours only after it fails on `origin/main` without your change.

## How to work

- Repository content is English: code, docs, scripts, tests and commits. Product UI strings in `t()`, translations, matching fixtures and selectors, agent-facing product prompts and `README.zh.md` may be Chinese. Follow the user's language in conversation.
- Commit format: `<scope>(<ticket>): <subject>`, in English. Put `Closes #N` on its own line when the commit finishes ticket N, or `Part of #N` for one segment.
- Read files in full before editing, and check consumers before moving or renaming paths. Ask before removing intentional functionality or changing intended behavior.
- Do not write code comments; express intent through naming and structure. Only English documentation of a public API or of external behavior the code cannot show is allowed. Delete other legacy comments when touched.
- Use top-level imports only, avoid unexplained `any`, and inline one-line helpers with a single call site. Verify external package APIs against the installed version's types and source.
- Use the established library or SDK when one covers the need; a hand-written replacement needs a stated reason.
- When you fix a defect, name its bug class, search every path the change touches for other instances, and fix them together.
- Design first for a change to persisted state, a wire or step protocol, or concurrency: write a one-page design (states, transitions, every path that reads or writes the state, the behavior on each failure) before code, with one test per path.
- Decide by your own recommendation and say in chat what you chose and why. Ask ian for payments, credentials, intended-behavior or design changes, and decisions explicitly routed to him.
- Keep each change small and self-contained.
- Do not commit verification evidence (logs, screenshots, probe output).

Where to look:

- UI work under `apps/web/src`: `apps/web/DESIGN-RULES.md`, then `.claude/skills/design-cairn/SKILL.md`.
- Every user-facing feature has a row in `.claude/skills/verify-cairn/feature-map.json`; run `node scripts/generate-feature-map.mjs` after changing routes, test ids or shortcuts. Acceptance and evidence: `.claude/skills/verify-cairn/SKILL.md`.
- Test scope: `docs/spec/19-test-layering-and-blast-radius.md`; use real e2e for complex features.
- Model-side latency, failures and usage: Langfuse first, `docs/ops/langfuse.md#debugging-a-turn-or-task`.
- Model roles and banned models for dispatched lanes: `docs/ops/lane-workers.md`.
- Harness profile rules: `docs/spec/30-harness-profile-opt-in.md`.
- Long-running servers and loops: `node scripts/owned-process.mjs -- <command>`, never `nohup`, `setsid`, `disown` or a trailing `&`.

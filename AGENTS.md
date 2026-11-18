# Cairn Development Rules

Before any change under `apps/web/src`, read `apps/web/DESIGN-RULES.md` and invoke the `design-cairn` skill, before reading or editing the code.

## Safety

- This repository is public: never commit secrets, credentials, internal addresses, personal information or quota details.
- Never force push, use `--no-verify`, bypass hooks with `core.hooksPath`, or run `git reset --hard`, `git clean`, `git stash` or `git checkout .`. Never overwrite uncommitted work you did not write.
- Stage only your own changes with explicit paths; never use `git add -A` or `git add .`.
- Commit identity: every agent, on a host or in a Claude Code cloud session, commits as `xiechimon <157263579+xiechimon@users.noreply.github.com>` (ian, 2026-11-16). Authorized host agents push with his existing user gh login using ordinary git/gh, without an App token; a cloud session pushes with its own session access. Existing `Claude <noreply@anthropic.com>` and bot commits remain accepted; preserve their authors. Git hooks are not installed; run verification explicitly before pushing. See `docs/ops/agent-bot-identity.md` before using an older worktree or compatibility wrapper.
- Do not run postinstall scripts without explicit user authorization; install dependencies with scripts disabled unless authorized.
- Seams: read the comments in `biome.json` before changing locked imports (`@earendil-works/*`, `@modelcontextprotocol/sdk`, `simple-git`, `isomorphic-git`, `cron-parser`) and consume them through thin bridges. Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; the exceptions are the in-server Coordinator runtime, `apps/server/src/coordinator/runtime/`, and the MCP connector client in `apps/server/src/services/mcp-servers.ts`.
- Never kill another lane's processes; inspect the PID, command and working directory before stopping a process you started. Shared ports, heavy slots and worktree rules: `docs/ops/worktrees-and-ports.md`.
- No change may edit what judges it: the trajectory exporter, its outcome fields and the pack schema (the eval globs in `packages/shared/merge-gate-paths.json`).
- Before pushing a change to a security surface, run `/security-review` and fix confirmed findings; name any finding you leave unfixed, with its reason, in the commit message.

Security surfaces (the `credentials`, `machineAndCommandBoundary` and `externalEntryAuth` lists in `packages/shared/merge-gate-paths.json`; `apps/server/test/merge-gate-paths-json.test.ts` fails when this list differs):

- Keys and encryption: `apps/server/src/lib/{secret-box,keys,token-auth,attachments-token}.ts`, `apps/server/src/services/{secrets,credentials,api-keys,oauth,github-connection,github-connection-device,github-device-core}.ts`, `apps/server/src/coordinator/{credentials,codex-login}.ts`
- Machine registration and dispatch protocol: `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts`, `apps/daemon/src/{credentials,secret-channel,machine-client}.ts`, `apps/daemon/src/backend/command-gate.ts`
- MCP auth and external entry points: `apps/server/src/services/{mcp-face,mcp-servers}.ts`

## Ship

Work lands on `main` directly. There is no pull request, merge queue or PR-body format. Production safety lives in the deploy: `scripts/ops/deploy-watch.sh` deploys only main commits whose `check`, `pack-smoke` and `e2e-gate` runs are green, with a migration rehearsal, a backup and rollback. A Claude Code cloud session lands work the same way: it pushes `HEAD:main` and opens no pull request, whatever branch its session defaults name (ian, 2026-11-16).

Work happens in worktrees, never in the primary checkout at `~/Code/AgentProjects/cairn`: a machine-level pre-commit hook there refuses commits, and its tree stays clean so `cairn-autopull` can fast-forward it to `origin/main`.

1. Work in your own worktree on a branch from the latest `origin/main`.
2. Commit any uncommitted changes. Tidy noisy intermediate commits into a few clear ones while they are still unpushed.
3. `git fetch origin main` and rebase onto the latest `origin/main`; resolve conflicts. If the rebase floods add/add conflicts in unrelated files, the clone is shallow: run `git rebase --abort`, `git fetch --quiet --unshallow origin main`, then rebase again.
4. Verify once: `pnpm prepush`, `pnpm test:changed`, and `/security-review` when a security surface changed. `pnpm test:changed` runs the changed test files and the tests named after changed source files, within a 10-minute budget; CI runs the full suite. Do not run `vitest --changed` locally: a shared package change selects nearly every test and took over an hour (2026-11-17). Web e2e runs in CI after the push, not locally (ian, 2026-11-16): a local affected run took 10 to 18 minutes, produced load-induced false failures, and a shared style change selects nearly the whole suite anyway. While writing or fixing a spec, run that one spec with `pnpm exec playwright test <spec>`.
5. Push without force: `git push origin HEAD:main`.
6. If the push is rejected because `origin/main` is ahead, fetch, rebase and push again. Do not repeat step 4 after a later fetch, rebase or rejected push unless conflict resolution or other local edits changed files after it passed.
7. A conflict that changes behavior: resolve it, then stop and ask ian before pushing.
8. Check CI on `origin/main` before pushing. If it is red, compare the failing jobs with the area your change touches: overlap means fix it or wait; no overlap means you may push, but when a red job covers your tests, verify them locally yourself. After pushing, watch CI on your commit and diff its failing jobs against the parent's: new failures are yours — fix them, or revert your commit if you cannot fix quickly; an identical failure signature is inherited — report the owning lane in chat, your commit stays. A red that survives several runs unclaimed and blocks deploys falls to the next lane needing a green deploy, or to ian.
9. Once your work is on `main`, delete every remote branch you pushed for it (`git push origin --delete <branch>`) without asking; this standing approval covers only branches you pushed yourself (mon X, 2026-11-18).

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

- UI work under `apps/web/src`: `apps/web/DESIGN-RULES.md`, then `.claude/skills/design-cairn/SKILL.md` (see the first line of this file).
- Every user-facing feature has a row in `.claude/skills/verify-cairn/feature-map.json`; run `node scripts/generate-feature-map.mjs` after changing routes, test ids or shortcuts. Acceptance and evidence: `.claude/skills/verify-cairn/SKILL.md`.
- Test scope: `docs/spec/19-test-layering-and-blast-radius.md`; use real e2e for complex features.
- Model-side latency, failures and usage: Langfuse first, `docs/ops/langfuse.md#debugging-a-turn-or-task`.
- Model roles and banned models for dispatched lanes: `docs/ops/lane-workers.md`.
- Harness profile rules: `docs/spec/30-harness-profile-opt-in.md`.
- Long-running servers and loops: `node scripts/owned-process.mjs -- <command>`, never `nohup`, `setsid`, `disown` or a trailing `&`.

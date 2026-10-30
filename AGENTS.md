# Cairn Development Rules

## Safety

- This repository is public: never commit secrets, credentials, internal addresses, personal information or quota details.
- Never force push, use `--no-verify`, bypass hooks with `core.hooksPath`, or run `git reset --hard`, `git clean`, `git stash` or `git checkout .`.
- Stage only your own changes with explicit paths; never use `git add -A` or `git add .`.
- Confirm lockfile changes with ian before committing `pnpm-lock.yaml`; authorized changes require `CAIRN_ALLOW_LOCKFILE_CHANGE=1`.
- Do not run postinstall scripts without explicit user authorization; install dependencies with scripts disabled unless authorized.
- Seam discipline: read the comments in `biome.json` before changing locked imports (`@earendil-works/*`, `@modelcontextprotocol/sdk`, `simple-git`, `isomorphic-git`, `cron-parser`); consume them through thin bridges.
- Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; check the seam before moving files or adding dependencies.
- Never kill another lane's processes; inspect the PID, command and working directory before stopping a process you started.
- Do not set `TMPDIR` without `CAIRN_HEAVY_SLOTS_DIR`; all lanes must share the heavy-work slot directory.
- Run `/security-review` before opening a PR touching any security surface below; fix confirmed findings, or record the reason in Risk and ask ian to confirm an unfixed finding.

Security surfaces (keep this list synchronized with `.claude/workflows/pr-gate.js` and `packages/shared/src/records/merge-gate.ts`):

- Keys and encryption: `apps/server/src/lib/{secret-box,keys,token-auth,attachments-token}.ts`, `apps/server/src/services/{secrets,credentials,api-keys,oauth}.ts`
- Machine registration and dispatch protocol: `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts`, `apps/daemon/src/{credentials,secret-channel,machine-client}.ts`, `apps/daemon/src/backend/command-gate.ts`
- MCP auth and external entry points: `apps/server/src/services/{mcp-face,mcp-servers}.ts`

## Model roles

| Role | Model |
|---|---|
| Orchestration | `claude-opus-5-5` |
| Implementation | Codex CLI with `gpt-6.1-sol`, or `claude-sonnet-5-5` |
| Mechanical work | `claude-haiku-5-5` |
| Review | Always by the other vendor than the implementer (ADR 0027), from a fresh context |

- A run never switches models on quota exhaustion: save progress and pause until the quota window resets.
- **Do not use**: extra models, gpt-6-astra (Codex too; keep its original model), the GPT 5.6 series, older-generation models, MiniMax M3, DeepSeek V4 Flash. The machine-checked ids are `deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra` and `gpt-5.6*`: `BANNED_MODEL_IDS` in `scripts/lane-model-policy.mjs` holds them, and `scripts/lane-model-policy.test.mjs` fails when this list and `BANNED_MODEL_IDS` differ or when a role in the table names one of them.
- The table binds orchestrator-dispatched runs. Overnight lanes use `ai-route`; routing and its quota limitations are documented in `docs/ops/lane-workers.md`.
- The Review row governs independent reviews when required below; ordinary changes do not require another vendor.

## Merge routes

- Required CI checks must pass on the PR's current head before an agent enables merge; a local pass does not substitute for CI.
- Agents may enable merge only when `.claude/workflows/pr-gate.js` returns go with `mergedBy: 'auto-merge'` ([ADR 0028](docs/adr/0028-phase-1-merge-routes.md)); protected-path PRs and every other route go to ian. Never merge or arm auto-merge on ian's route unless ian authorizes it in chat.
- ian may admin-merge. That authority does not extend to agents.
- Never add the `needs-decision` label. Agents decide by their own recommendation, say what they chose and why in chat, and continue; ask ian for payments, credentials, intended-behavior or ADR changes, and decisions explicitly routed to him.
- Before asking ian about a PR with auto-merge armed, disarm it with `gh pr merge <n> --disable-auto`.
- Follow `.claude/skills/pr-cairn/SKILL.md` for PR creation and merge mechanics, and `docs/ops/agent-bot-identity.md` for bot versus human identity and merge methods.
- After opening an eligible PR, arm its merge and stop; CI owns the remaining checks.

## How to work

- Repository content is English, including code, docs, scripts, tests, commits, issues and PRs. Product UI source strings in `t()`, translations, matching fixtures and selectors, agent-facing product prompts and `README.zh.md` may be Chinese. Quote Chinese UI labels and paths in backticks in prose; translate any legacy prose section you touch.
- Follow the user's language in conversation. Answer questions first; use plain technical prose without filler or emoji.
- Read files in full before editing. Inspect available facts before recommending a change, and check consumers before moving or renaming paths. Ask before removing intentional functionality or changing intended behavior.
- Do not write code comments; express intent through naming and code structure. Only English documentation of a public API or external behavior the code cannot show (browser/platform bugs or third-party quirks) is allowed. Delete other legacy comments when touched.
- Use top-level imports only, avoid unexplained `any`, and inline one-line helpers with a single call site. Verify external package APIs against the installed version's types and source.
- List failure modes before implementing behavior changes, and write their tests first. Use real e2e for complex features; follow `docs/spec/19-test-layering-and-blast-radius.md` for test scope.
- Run related tests by hand during development: `pnpm exec vitest run --changed` and `pnpm --filter @cairn/web e2e:affected`. The full suites run in CI; avoid routine full local e2e runs.
- After code changes, run `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse`; also run `pnpm spec:parse` after resolving e2e conflicts. Do not run `pnpm build` before committing.
- Run `pnpm prepush` before pushing. It runs fast checks only; tests run in CI. A push is unverified until CI reports on that head. Run the exact command of any CI step your diff changes.
- Verify mechanism changes on compiled output, runtime logs or snapshots; use `.claude/skills/verify-cairn/SKILL.md` for acceptance guidance.
- Use one review round before opening a code PR; require a fresh, other-vendor independent review only for protected or security paths. Docs-only changes outside protected or security paths skip code review; protected or security paths always get the independent review. Fix confirmed findings and record unfixed findings with reasons in Risk.
- After three review rounds, rethink the approach or hand the PR to ian.
- Review PRs with `docs/pr-review.md`; read diffs without switching branches in a shared worktree.
- Small changes need no issue or overlap lookup. Reuse an existing issue or PR when it already covers the request.
- Write PR bodies per `.claude/skills/pr-cairn/SKILL.md`: Proof first, then What, with Review and Risk collapsed; visible prose is capped at 600 characters.
- Commit format: `<scope>(<ticket>): <subject>`, in English. Put `closes #N` in the commit message for the closing segment, never only in the PR body; do not close a parent ticket from an intermediate segment.

## Worktrees and ports

- Branch from `origin/main`. Create worktrees from the main checkout using absolute paths: `git worktree add "$(git rev-parse --show-toplevel)/.claude/worktrees/<name>" <branch>`.
- Run `pnpm exec husky` in a new worktree before its first commit, and verify `.husky/_/pre-push` exists.
- `E2E_PORT` defaults to 8399; check `lsof -iTCP:8399` before use. If occupied, choose another port and leave its owner running.
- `e2e:affected` leases a heavy slot and its port (base 8398, stride 10); `E2E_AFFECTED_PORT` changes the base and explicit `E2E_PORT` overrides it. Inspect any reported port holder before retrying.
- Run only one Playwright instance per worktree; shared build output and ports are exclusive. Separate worktrees keep their own build outputs.
- Dev ports default to 5173 and 8787; use `CAIRN_DEV_WEB_PORT` and `CAIRN_DEV_SERVER_PORT` for another stack.

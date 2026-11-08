# Cairn Development Rules

## Safety

- This repository is public: never commit secrets, credentials, internal addresses, personal information or quota details.
- Never force push, use `--no-verify`, bypass hooks with `core.hooksPath`, or run `git reset --hard`, `git clean`, `git stash` or `git checkout .`.
- Stage only your own changes with explicit paths; never use `git add -A` or `git add .`.
- Confirm lockfile changes with ian before committing `pnpm-lock.yaml`; authorized changes require `CAIRN_ALLOW_LOCKFILE_CHANGE=1`.
- Do not run postinstall scripts without explicit user authorization; install dependencies with scripts disabled unless authorized.
- Seam discipline: read the comments in `biome.json` before changing locked imports (`@earendil-works/*`, `@modelcontextprotocol/sdk`, `simple-git`, `isomorphic-git`, `cron-parser`); consume them through thin bridges.
- Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; the one exception is the in-server Coordinator runtime, `apps/server/src/coordinator/runtime/` (D114). Check the seam before moving files or adding dependencies.
- Never kill another lane's processes; inspect the PID, command and working directory before stopping a process you started.
- Do not set `TMPDIR` without `CAIRN_HEAVY_SLOTS_DIR`; all lanes must share the heavy-work slot directory.
- Codex security review is no longer part of the merge route (ian, 2026-11-06): `review-gate` requires the code review only. The security-surface lists below still mark protected paths for routing and ownership.

Security surfaces (the `credentials`, `machineAndCommandBoundary` and `externalEntryAuth` lists in `packages/shared/merge-gate-paths.json`, the one source for protected and auto-merge paths; `apps/server/test/merge-gate-paths-json.test.ts` fails when this list differs):

- Keys and encryption: `apps/server/src/lib/{secret-box,keys,token-auth,attachments-token}.ts`, `apps/server/src/services/{secrets,credentials,api-keys,oauth}.ts`, `apps/server/src/coordinator/{credentials,codex-login}.ts`
- Machine registration and dispatch protocol: `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts`, `apps/daemon/src/{credentials,secret-channel,machine-client}.ts`, `apps/daemon/src/backend/command-gate.ts`
- MCP auth and external entry points: `apps/server/src/services/{mcp-face,mcp-servers}.ts`

## Model roles

| Role | Model |
|---|---|
| Orchestration | `claude-opus-5-5` |
| Implementation | Codex CLI with `gpt-6.1-sol`, or `claude-sonnet-5-5` |
| Mechanical work | `claude-haiku-5-5` |
| Review | Codex cloud review, from a fresh context, bound to the reviewed head |

- A run never switches models on quota exhaustion: save progress and pause until the quota window resets.
- **Do not use**: extra models, gpt-6-astra (Codex too; keep its original model), the GPT 5.6 series, older-generation models, MiniMax M3, DeepSeek V4 Flash. The machine-checked ids are `deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra` and `gpt-5.6*`: `BANNED_MODEL_IDS` in `scripts/lane-model-policy.mjs` holds them, and `scripts/lane-model-policy.test.mjs` fails when this list and `BANNED_MODEL_IDS` differ or when a role in the table names one of them.
- The table binds orchestrator-dispatched runs. Overnight lanes use `ai-route`; routing and its quota limitations are documented in `docs/ops/lane-workers.md`.
- Codex reviews every change whoever implemented it; a new head invalidates the verdict on the old one.

## Merge routes

- Required CI checks must pass on the PR's current head before an agent enables merge; a local pass does not substitute for CI.
- Agents may enable merge only when `.claude/workflows/pr-gate.js` returns go with `mergedBy: 'auto-merge'`. Protected-path PRs enter the merge queue with every other green PR. Never merge or arm auto-merge on a PR labelled `coordinator-hold`.
- ian may admin-merge. When ian authorizes a named PR on his route in chat, an agent may merge it with `gh pr merge <n> --admin`, using the merge method `docs/ops/agent-bot-identity.md` gives its opener (`--squash` for a human-opened PR, `--rebase` for one opened by `app/cairnwright`), once every required check passes on the current head, `review-gate` included, and the PR body has no unchecked task. Without that per-PR authorization, agents never use `--admin`.
- The eval ruler is protected so no PR can edit what judges it: `integration/eval/**`, `.claude/hillclimb/**`, the trajectory exporter, its outcome fields and the pack schema (the eval globs in `packages/shared/merge-gate-paths.json`).
- Agents decide by their own recommendation, say what they chose and why in chat, and continue; ask ian for payments, credentials, intended-behavior or design changes, and decisions explicitly routed to him, and put `coordinator-hold` on the PR while that decision is pending.
- Before asking ian about a PR with auto-merge armed, disarm it with `gh pr merge <n> --disable-auto`.
- A PR labelled `coordinator-hold` neither queues nor merges, keeps `pr-evidence` red and has auto-merge disarmed: the coordinator asked for changes or a person's decision is pending. The session that owns it keeps the label on until it has pushed the requested work or ian gave the decision in chat, then asks the coordinator to remove it.
- Follow `.claude/skills/pr-cairn/SKILL.md` for PR creation and merge mechanics, and `docs/ops/agent-bot-identity.md` for bot versus human identity and merge methods.
- PRs that `.mergify.yml` admits enter the Mergify merge queue automatically once the `review-gate` check (the Codex cloud review) and `merge-route` pass; stop there and never `gh pr merge` them. Path class does not keep a PR on ian's route.

## How to work

- Repository content is English, including code, docs, scripts, tests, commits, issues and PRs. Product UI source strings in `t()`, translations, matching fixtures and selectors, agent-facing product prompts and `README.zh.md` may be Chinese. Quote Chinese UI labels and paths in backticks in prose; translate any legacy prose section you touch.
- Follow the user's language in conversation.
- Read files in full before editing, and check consumers before moving or renaming paths. Ask before removing intentional functionality or changing intended behavior.
- Do not write code comments; express intent through naming and code structure. Only English documentation of a public API or external behavior the code cannot show (browser/platform bugs or third-party quirks) is allowed. Delete other legacy comments when touched.
- Use top-level imports only, avoid unexplained `any`, and inline one-line helpers with a single call site. Verify external package APIs against the installed version's types and source.
- Every user-facing feature has a row in `.claude/skills/verify-cairn/feature-map.json` with reach steps, states, research, frontend design and backend design. A new route, settings section or page needs a row whose research and designs exist first; run `node scripts/generate-feature-map.mjs` after changing routes, test ids or shortcuts.
- Use real e2e for complex features; follow `docs/spec/19-test-layering-and-blast-radius.md` for test scope.
- Run related tests by hand during development: `pnpm exec vitest run --changed` and `pnpm --filter @cairn/web e2e:affected`. The full suites run in CI; avoid routine full local e2e runs.
- After code changes, run `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse`; also run `pnpm spec:parse` after resolving e2e conflicts. Do not run `pnpm build` before committing.
- Run `pnpm prepush` before pushing. It runs fast checks only; tests run in CI. A push is unverified until CI reports on that head. Run the exact command of any CI step your diff changes.
- UI work under `apps/web/src`: read `apps/web/DESIGN-RULES.md` first (checkable rules), then `apps/web/DESIGN.md` (full reference). Write the brief from `.claude/skills/design-cairn/SKILL.md`, open the reference shots for the surface in `docs/design/references/`, and show a reference-versus-ours row per state in the PR. A new feature on a main surface needs a page draft before code.
- Verify mechanism changes on compiled output, runtime logs or snapshots; use `.claude/skills/verify-cairn/SKILL.md` for acceptance guidance.
- Do not run a local `codex exec` or `claude -p` review before pushing. Codex cloud code review (`chatgpt-codex-connector[bot]`) reviews every push through the review gate, and that review on the PR head is the required review. Fix confirmed findings, and record unfixed findings with reasons in Risk.
- Protected paths require Codex cloud code review on the PR head. Canonical security surfaces are covered by that review: no separate security approval is required while the 2026-11-06 ruling holds. Docs-only changes outside protected paths skip code review.
- After three review rounds, rethink the approach or hand the PR to ian.
- Review PRs with `docs/pr-review.md`; read diffs without switching branches in a shared worktree.
- Decisions are recorded in the owner's plan decision table, not as ADRs.
- Small changes need no issue or overlap lookup. Reuse an existing issue or PR when it already covers the request.
- Write PR bodies per `.claude/skills/pr-cairn/SKILL.md`: Proof first, then What, with Review and Risk collapsed; visible prose is capped at 600 characters.
- Commit format: `<scope>(<ticket>): <subject>`, in English. Put `closes #N` in the commit message for the closing segment, never only in the PR body; do not close a parent ticket from an intermediate segment.

## Harness profile (spec 30)

- It is off by default and stays testable that way: a team with no `harness_profile` row serves nothing, and a test proves it. Never gate it on `flag()`, whose absent value is on for the owner.
- A profile holds no secret value: server names, transports, commands, URLs and environment-variable names only. A strict schema rejects anything else, and a new field needs a reason it cannot carry a credential.
- A renderer that does not understand a field, or a harness version whose schema is unverified, stops the apply and names the field. Silent loss counts as a defect.
- Apply never overwrites content it does not manage, never resolves a conflict by recency, and reads the file back after writing.
- Any machine-level manifest or apply path touches `apps/server/src/routes-machine.ts` or `apps/server/src/services/machine*.ts`, which are owner-routed.

## Review guidelines

- Review only what the PR changes. Report a defect on a line the PR did not add or modify only when the PR's change makes it reachable or worse; otherwise leave it for the nightly scan, which files old-code problems as issues.
- On a later review of the same PR, read only the commits pushed since the last review and do not repeat a finding that is already raised or resolved.
- Name the bug class of each finding and list every instance of it in the diff, so one push fixes the class instead of one line per round.
- Use P0 or P1 only for a defect that breaks behavior, loses data or opens a security hole. Ordinary code-review P2/P3 findings do not block; canonical security surfaces require zero unresolved security findings at every severity.

## Worktrees and ports

- Branch from `origin/main`. Create worktrees from the main checkout using absolute paths: `git worktree add "$(git rev-parse --show-toplevel)/.claude/worktrees/<name>" <branch>`.
- Run `pnpm exec husky` in a new worktree before its first commit, and verify `.husky/_/pre-push` exists.
- `E2E_PORT` defaults to 8399; check `lsof -iTCP:8399` before use. If occupied, choose another port and leave its owner running.
- `e2e:affected` leases a heavy slot and its port (base 8398, stride 10); `E2E_AFFECTED_PORT` changes the base and explicit `E2E_PORT` overrides it. Inspect any reported port holder before retrying.
- Run only one Playwright instance per worktree; shared build output and ports are exclusive. Separate worktrees keep their own build outputs.
- Dev ports default to 5173 and 8787; use `CAIRN_DEV_WEB_PORT` and `CAIRN_DEV_SERVER_PORT` for another stack.
- Start any server, stack or loop that must outlive one command as a background task through `node scripts/owned-process.mjs -- <command>`; it dies with its owner. Never use `nohup`, `setsid`, `disown` or a trailing `&`; `scripts/spawn-ownership.test.mjs` rejects `detached` or `unref()` children outside the helper.
- The host's worktree reaper removes a `.claude/worktrees/` tree once its PR is merged or closed at the tree's exact head, the tree is clean and no process uses it; it reports every tree it keeps.
- Start any server, stack or loop that must outlive one command as a background task through `node scripts/owned-process.mjs -- <command>`; it dies with its owner. Never use `nohup`, `setsid`, `disown` or a trailing `&`; `scripts/spawn-ownership.test.mjs` rejects `detached` or `unref()` children outside the helper.
- The host's worktree reaper removes a `.claude/worktrees/` tree once its PR is merged or closed at the tree's exact head, the tree is clean and no process uses it; it reports every tree it keeps.

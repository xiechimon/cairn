# Cairn Development Rules

## Safety

- This repository is public: never commit secrets, credentials, internal addresses, personal information or quota details.
- Never force push, use `--no-verify`, bypass hooks with `core.hooksPath`, or run `git reset --hard`, `git clean`, `git stash` or `git checkout .`. The one exception is the pre-merge review gate (`.claude/workflows/pr-gate.js`, `docs/pr-review.md`): its evidence check runs in its own worktree and sets `core.hooksPath=/dev/null` so a hook shipped in the reviewed tree cannot run with the reviewer's credentials.
- Stage only your own changes with explicit paths; never use `git add -A` or `git add .`.
- Agent sessions on a host with the App key commit and push only as the App: `~/.cairn/tools/app-token/as-bot.sh git commit ...` and `as-bot.sh git push origin HEAD:<branch>`, and open PRs with `as-bot.sh gh pr create`. A Claude Code cloud session has no App key and commits with plain git as its own identity, `Claude <noreply@anthropic.com>` (`cloudAgents` in `packages/shared/commit-identity.json`, ian 2026-11-10). Only commits ian types himself carry his identity; the hooks and the `commit-author` check enforce that file.
- Do not run postinstall scripts without explicit user authorization; install dependencies with scripts disabled unless authorized.
- Seam discipline: read the comments in `biome.json` before changing locked imports (`@earendil-works/*`, `@modelcontextprotocol/sdk`, `simple-git`, `isomorphic-git`, `cron-parser`); consume them through thin bridges.
- Keep GitOps, MCP and LLM provider access behind `apps/daemon/src/backend/`; the one exception is the in-server Coordinator runtime, `apps/server/src/coordinator/runtime/`. Check the seam before moving files or adding dependencies.
- Never kill another lane's processes; inspect the PID, command and working directory before stopping a process you started.
- Do not set `TMPDIR` without `CAIRN_HEAVY_SLOTS_DIR`; all lanes must share the heavy-work slot directory.
- A security-surface PR enters the merge queue with every other green PR (ian, 2026-11-12). Before merging it, run `/security-review`; fix confirmed findings, or record unfixed ones with reasons in Risk. It merges once required CI passes on the head. `pr-evidence` requires the head-bound disposition line in Merge routes.

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
| Review | none: code review is off |

- A run never switches models on quota exhaustion: save progress and pause until the quota window resets.
- **Do not use**: extra models, gpt-6-astra (Codex too; keep its original model), the GPT 5.6 series, older-generation models, MiniMax M3, DeepSeek V4 Flash. The machine-checked ids are `deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra` and `gpt-5.6*`: `BANNED_MODEL_IDS` in `scripts/lane-model-policy.mjs` holds them, and `scripts/lane-model-policy.test.mjs` fails when this list and `BANNED_MODEL_IDS` differ or when a role in the table names one of them.
- The table binds orchestrator-dispatched runs. Overnight lanes use `ai-route`; routing and its quota limitations are documented in `docs/ops/lane-workers.md`.
- Code review is off, Codex cloud review included: no check, queue condition or label waits for one (ian, 2026-11-12).

## Merge routes

- Required CI checks must pass on the PR's current head before an agent enables merge; a local pass does not substitute for CI. No review verdict, review thread or label holds a PR (ian, 2026-11-12).
- Agents may enable merge only when `.claude/workflows/pr-gate.js` returns go with `mergedBy: 'auto-merge'`. Protected-path PRs enter the merge queue with every other green PR, including security surfaces and PRs that used to be owner-routed. Path class does not keep a PR on ian's route. A security surface also needs `/security-review` findings fixed or recorded in Risk, as a line outside fenced code: `Security review (<40-hex head>): fixed` or `Security review (<40-hex head>): recorded`. `pr-evidence` fails without that line, and the queue already requires `pr-evidence`.
- ian may admin-merge. When ian authorizes a named PR on his route in chat, an agent may merge it with `gh pr merge <n> --admin --squash`, whoever opened it, once every required check passes on the current head and the PR body has no unchecked task. Without that per-PR authorization, agents never use `--admin`.
- The eval ruler is protected so no PR can edit what judges it: `integration/eval/**`, `.claude/hillclimb/**`, the trajectory exporter, its outcome fields and the pack schema (the eval globs in `packages/shared/merge-gate-paths.json`).
- Agents decide by their own recommendation, say what they chose and why in chat, and continue; ask ian for payments, credentials, intended-behavior or design changes, and decisions explicitly routed to him, and keep the PR a draft while that decision is pending: a draft does not queue.
- Before asking ian about a PR with auto-merge armed, disarm it with `gh pr merge <n> --disable-auto`.
- Follow `.claude/skills/pr-cairn/SKILL.md` for PR creation and merge mechanics, and `docs/ops/agent-bot-identity.md` for bot versus human identity and merge methods.
- PRs that `.mergify.yml` admits enter the Mergify merge queue automatically once `merge-route`, `pr-evidence`, `pr-size`, `commit-author` and the required CI checks pass on a head that is not a draft; stop there and never `gh pr merge` them. Path class does not keep a PR on ian's route. A `cairnwright[bot]` author uses the bot queue under the same admission.

## How to work

- Repository content is English, including code, docs, scripts, tests, commits, issues and PRs. Product UI source strings in `t()`, translations, matching fixtures and selectors, agent-facing product prompts and `README.zh.md` may be Chinese. Quote Chinese UI labels and paths in backticks in prose; translate any legacy prose section you touch.
- Follow the user's language in conversation.
- Read files in full before editing, and check consumers before moving or renaming paths. Ask before removing intentional functionality or changing intended behavior.
- Do not write code comments; express intent through naming and code structure. Only English documentation of a public API or external behavior the code cannot show (browser/platform bugs or third-party quirks) is allowed. Delete other legacy comments when touched.
- Use top-level imports only, avoid unexplained `any`, and inline one-line helpers with a single call site. Verify external package APIs against the installed version's types and source.
- Use the established library or SDK when one covers the need (for example the OpenTelemetry SDK for traces, a maintained parser for TOML or YAML). A hand-written replacement needs a stated reason in the design or PR body: the library can't meet a named requirement, or the code is a thin bridge over a locked seam.
- Every user-facing feature has a row in `.claude/skills/verify-cairn/feature-map.json` with reach steps, states, research, frontend design and backend design. A new route, settings section or page needs a row whose research and designs exist first; run `node scripts/generate-feature-map.mjs` after changing routes, test ids or shortcuts.
- Use real e2e for complex features; follow `docs/spec/19-test-layering-and-blast-radius.md` for test scope.
- Run related tests by hand during development: `pnpm exec vitest run --changed` and `pnpm --filter @cairn/web e2e:affected`. The full suites run in CI; avoid routine full local e2e runs.
- After code changes, run `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse`; also run `pnpm spec:parse` after resolving e2e conflicts. Do not run `pnpm build` before committing.
- Run `pnpm prepush` before pushing. It runs fast checks only; tests run in CI. A push is unverified until CI reports on that head. Run the exact command of any CI step your diff changes.
- UI work under `apps/web/src`: read `apps/web/DESIGN-RULES.md` first (checkable rules), then `apps/web/DESIGN.md` (full reference). Write the brief from `.claude/skills/design-cairn/SKILL.md`, open the reference shots for the surface in `docs/design/references/`, and show a reference-versus-ours row per state in the PR. A new feature on a main surface needs a page draft before code.
- Verify mechanism changes on compiled output, runtime logs or snapshots; use `.claude/skills/verify-cairn/SKILL.md` for acceptance guidance.
- Do not commit verification evidence (logs, screenshots, probe output) to a PR branch: `main` has no `docs/verify/`. Screenshots for a PR body go on the `pr-assets/<pr-number>` side branch per `.claude/skills/pr-cairn/SKILL.md`; describe or link other evidence in the PR.
- Code review is off (ian, 2026-11-12): do not run a local `codex exec` or `claude -p` review before pushing and do not request a Codex cloud review. CI is the gate; record known defects you leave unfixed with reasons in Risk.
- A security surface needs `/security-review` findings fixed or recorded in Risk before merge; that does not send the PR to ian.
- Keep each PR to one self-contained change: aim for under 400 changed lines outside generated files and split anything past 1000 before review. The `pr-size` check fails a PR above 3000 changed lines outside `GENERATED_PATHS` in `scripts/pr-size.mjs`. Measured on 81 merged PRs: median open-to-merge is 18 minutes under 200 lines and 434 minutes over 3000.
- Branch every PR from `origin/main`. Do not open a PR whose base is another open PR's branch: dependent work waits until its base merges, then branches from the updated `main`. Until then, keep it on a local branch.
- Design first for a change to persisted state, a wire or step protocol, or concurrency: write a one-page design (states, transitions, every path that reads or writes the state, the behavior on each failure) and get it reviewed by the coordinator before writing code.
- Before code for a state or lifecycle feature (delivery, retry, pause, identity, attribution), list every path that reads or writes that state and the expected behavior on each, put the list in the PR body, and write one test per row. A review finding on such a PR is usually a missed row.
- When you fix a defect, name its bug class, search the whole PR diff and every entry path the change touches for other instances, and fix all of them in one push. A defect that is real but outside this PR's change goes to an issue, not into the PR.
- Never post Mergify commands (`@mergifyio queue`, `@mergifyio dequeue` or any other); the queue conditions drive the queue. A green PR enters the queue by itself; if it has not within 10 minutes, read the `Mergify Merge Queue` check run, fix the unmet condition it lists, and report it.
- Review PRs with `docs/pr-review.md`; read diffs without switching branches in a shared worktree.
- Small changes need no issue or overlap lookup. Reuse an existing issue or PR when it already covers the request.
- Write PR bodies per `.claude/skills/pr-cairn/SKILL.md`: Proof first, then What, with Review and Risk collapsed; visible prose is capped at 600 characters.
- Commit format: `<scope>(<ticket>): <subject>`, in English. Put `closes #N` in the commit message for the closing segment, never only in the PR body; do not close a parent ticket from an intermediate segment.

## Harness profile (spec 30)

- It is off by default and stays testable that way: a team with no `harness_profile` row serves nothing, and a test proves it. Never gate it on `flag()`, whose absent value is on for the owner.
- A profile holds no secret value: server names, transports, commands, URLs and environment-variable names only. A strict schema rejects anything else, and a new field needs a reason it cannot carry a credential.
- A renderer that does not understand a field, or a harness version whose schema is unverified, stops the apply and names the field. Silent loss counts as a defect.
- Apply never overwrites content it does not manage, never resolves a conflict by recency, and reads the file back after writing.
- Any machine-level manifest or apply path touches `apps/server/src/routes-machine.ts` or `apps/server/src/services/machine*.ts`. Those are security surfaces and merge under Merge routes.

## Code Review Rules

- Review only what the PR changes. Report a defect on a line the PR did not add or modify only when the PR's change makes it reachable or worse; otherwise leave it for the nightly scan, which files old-code problems as issues.
- On a later review of the same PR, read only the commits pushed since the last review and do not repeat a finding that is already raised or resolved.
- Name the bug class of each finding and list every instance of it in the diff in one comment, so one push fixes the class instead of one line per round. When a later commit adds another instance of a class already raised on this PR, add it to that class's thread instead of opening a new one.
- Use P0 or P1 only for a defect that breaks behavior, loses data or opens a security hole. These rules apply to a review someone asks for; no review runs by default. Findings are advisory at every severity: no check or queue condition waits for them (ian, 2026-11-12).
- Flag hand-rolled code that re-implements what a maintained library or SDK already does (protocol encoders, parsers, retry and backoff, API clients), unless the PR states why the library can't be used.

## Worktrees and ports

- Branch from `origin/main`. Create worktrees from the main checkout using absolute paths: `git worktree add "$(git rev-parse --show-toplevel)/.claude/worktrees/<name>" <branch>`.
- Run `pnpm exec husky` in a new worktree before its first commit, and verify `.husky/_/pre-push` exists.
- `E2E_PORT` defaults to 8399; check `lsof -iTCP:8399` before use. If occupied, choose another port and leave its owner running.
- Every Vitest and Playwright configuration waits for a shared heavy slot before workers or webServer builds start, including direct package-local commands and task workspaces. `CAIRN_HEAVY_SLOTS` defaults to 2; `CAIRN_HEAVY_SLOTS_DIR` selects the shared directory. CI bypasses only when that directory is absent. Waiting output names holder pid and cwd; dead holders are reclaimed. Keep Python 3 available for admission, and never delete active slot guard files.
- `e2e:affected` delegates admission to Playwright. Its port base is 8398 (direct Playwright: 8399), with stride 10 per slot; `E2E_AFFECTED_PORT` changes the affected base and `E2E_PORT` overrides the base. The configuration selects the leased slot's build directory. Inspect any reported port holder before retrying.
- Screenshot fixture and trip configs use base 8399; live worlds use bases 8441 and 8443, with readiness ports one higher. All use the same stride 10 per leased slot, including custom bases. Live screenshot workers derive the same ports as their servers; leased fixture runners reject occupied ports.
- Run only one Playwright instance per worktree; shared build output and ports are exclusive. Separate worktrees keep their own build outputs.
- Dev ports default to 5173 and 8787; use `CAIRN_DEV_WEB_PORT` and `CAIRN_DEV_SERVER_PORT` for another stack.
- Start any server, stack or loop that must outlive one command as a background task through `node scripts/owned-process.mjs -- <command>`; it dies with its owner. Never use `nohup`, `setsid`, `disown` or a trailing `&`; `scripts/spawn-ownership.test.mjs` rejects `detached` or `unref()` children outside the helper.
- The host's worktree reaper removes a clean worktree no process uses, wherever it lives, once its PR is merged or closed at the tree's exact head, or once it has been idle 3 days with its HEAD on a remote branch. It keeps trees under `~/.t3` and trees that hold another worktree, and reports every tree it keeps. Push work you want to survive. Each run also fast-forwards the main checkout to `origin/main` when it is on `main` with no tracked changes; worktree sessions load project skills from it, so do not leave it on another branch or with edits.

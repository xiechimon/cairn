# Cairn Development Rules

> Repository rules shared by agents and humans. A rule **can be overridden**, but only with explicit user confirmation (see "User Override" at the end).
> Project background and past decisions live in `~/.claude/projects/-Users-xmon-Code-AgentProjects-cairn/memory/MEMORY.md`; this file lists rules only and does not repeat facts.
> Working style, division of labor, model rules and the current progress summary are in `.claude/workflow.md`; the wrap-up retro uses `.claude/skills/retro-cairn`.

## Language

- **Everything committed to this repository is English**: code comments, docs, specs, ADRs, skills, scripts' messages, test titles, commit messages, PR titles and bodies, issue text. Do not mix Chinese into English text, and do not add English lines to a Chinese document as a stopgap; translate the section you touch.
- Exceptions: product UI text and its translations (Chinese source strings passed to `t()` and the i18n locale files), agent-facing prompt strings in product code, Chinese test fixtures and selectors that match that UI text, and `README.zh.md`. When prose has to name a Chinese UI label or a Chinese file path, quote it in backticks.
- Conversation with the user follows the user's language; only repository content is English.
- Machine check: `node scripts/english-only-gate.mjs` reds Chinese on added lines (prose in `.md` / `.yml`, comments in code files) and in commit messages of the branch, against `origin/main`. It runs in `pnpm prepush` for every change, including docs-only ones, and the `pr-evidence` check runs it on the PR body (`--text <file>`). Text inside backticks, fenced code blocks and HTML comments is not checked.
- Legacy Chinese content is being translated in batches; until a file is translated, edits to it follow the rule above.

## Conversational Style

- Technical prose. **No emoji** in commits, issues, PRs or code.
- No filler ("Thanks @user!", "Great question", "Sure thing"); answer directly.
- When explaining a non-trivial design, use four parts: problem, then a concrete example or short trace, then the solution, then why it is necessary versus optional complexity.
- When the user asks a question, **answer it first, then edit**.
- When agreeing or disagreeing with user feedback, state the position first ("Agree / disagree, because X"), then list the changes.

## Code Quality

- **Seam discipline comes first**: biome's `noRestrictedImports` locks `@earendil-works/*`, `@modelcontextprotocol/sdk`, `simple-git`, `isomorphic-git` and `cron-parser` so they are consumed only through thin bridge modules. **Before changing those import paths, read the comments in `biome.json`** (seam discipline 01 §5/§7.3 and related clauses); before moving a file, check that the seam still holds.
- Read a file in full before changing it; do not make broad edits based on search snippets.
- **Comment discipline (no comments)**: do not write comments. Express intent through naming and code structure. Agents treat comments as license to patch around problems, and other agents copy them. Only two kinds may exist, written in English:
  - external behavior the code cannot show: a browser or platform bug, a third-party quirk (for example `// Safari private mode throws on setItem`);
  - documentation of a public API.
  A comment that restates what the code does (for example `// --name defaults to hostname`), a to-do note, or a note about a future fix is a violation; fix the code instead. Legacy comments are being cleaned up in batches: comments that are not one of the two kinds above are **deleted, not translated**; surviving ones are translated to English. Machine check: see "Comment check" below.
- No `any` by default; when needed, write `any intentionally - <reason>`.
- A one-line helper with a single call site gets inlined.
- External package APIs: bundled types → read `node_modules/<pkg>/dist/*.d.ts`; only `@types/` → read `node_modules/@types/<pkg>/index.d.ts` plus the package's JS source; no types → run `node -e` or check the docs; never rely on memory. In this pnpm repo the top-level node_modules only links direct dependencies; if the path does not exist, look in `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/` (measured in this repo). Pin the version with `npm ls <pkg>`. Details: `~/.agents/wiki/wiki/外部包 API 事实源调研.md`.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports); top-level only.
- `apps/daemon/src/backend/` is the GitOps / MCP / LLM provider seam; other modules import it as an interface boundary and must not reach around it.
- **Ask first** before removing a feature or code that looks intentional.

## Commands

After code changes (not for docs-only changes):
```sh
pnpm lint       # biome ci . (the CI view)
pnpm format     # biome format --write . (do not run unless you mean to write files)
pnpm typecheck  # pnpm -r typecheck
pnpm spec:parse # spec parse gate (#1052): collects without executing, seconds; covers apps/web/e2e + integration/test
```
All of these must pass before committing. **Do not run `pnpm build`** (full vite build; not worth it before a commit).

Testing rules (mandatory; the canonical layering is `docs/spec/19-测试分层与受影响面.md`):
- **Do not write unit tests after the implementation**; if something gets a test, the test comes first.
- **E2E first**: verify complex features with real e2e. During development run the affected set with `pnpm --filter @cairn/web e2e:affected` (it falls back to the full suite when shared surfaces change: `src/ui`, styles, i18n, api, fixtures). **The full e2e suite runs in CI** (4 shards, no coverage reduction); run it locally only when a final review really needs it. Measured: 617 cases in 154s (not the old 1h+ figure), but it is the main source of memory pressure across lanes, so do not run it routinely.
- Narrow unit tests to the affected set with `pnpm exec vitest run --changed` (native in vitest 5; picks related tests from git changes, across projects). **Do not use `vitest related --changed`**: `related` treats the empty positional argument as "a given list of source files", skips the git change lookup and always selects 0 tests (measured 2026-10-20; source in the same section of `docs/spec/19`).
- **List failure modes before implementing**: before touching a system, enumerate every way it can fail; the code exists to make those scenarios pass.
- **After merging or resolving conflicts in e2e spec files, run `pnpm spec:parse`** (since #1052 there is a seconds-long gate: playwright `--list` collects every web spec plus integration tsc. M7 lesson: typecheck does not cover spec syntax, and a hand-resolved conflict that swallowed `});` to EOF only blew up later; green typecheck does not mean playwright can parse).
- **For mechanism changes, accept on real artifacts**: a claim that "X takes effect" (CSS/animation, on-disk or wire format, schema, shim traffic, verdict fields) must be checked on the **compiled output / runtime log / snapshot suite / runtime truth of that form**; reading source, reading config, or having installed dependencies is not acceptance. The claim → artifact → case table is in `.claude/skills/verify-cairn/SKILL.md`, section `机制生效验收:实物判据` (six cases including #656/#677, #735, #700).

Running verification servers (ports and `dist/` are exclusive):
- `dev:web` / `dev:server` / `dev:daemon`: dev servers on ports `5173` / `8787`. vite uses `strictPort`, so a taken port fails startup instead of silently moving to the next free port (moving is the dangerous case: the proxy target stays the same and the UI ends up driving another stack that owns the port). Overrides: `CAIRN_DEV_WEB_PORT` / `CAIRN_DEV_SERVER_PORT`.
- **E2E_PORT** defaults to 8399. Check it first with `lsof -iTCP:8399`; if another lane holds it, **do not kill it**, use another port. **`e2e:affected` defaults to 8398** (override with `E2E_AFFECTED_PORT`; an explicit `E2E_PORT` wins), separate from the full suite, same port discipline.
- **Do not run two playwright instances in the same worktree**: `vite build --mode fixture` writes the same `dist/` and they clobber each other. Separate worktrees each have their own dist and are fine.

Comment check: `node scripts/comment-discipline-gate.mjs` compares against `origin/main` and checks only added standalone comment lines and block-comment continuation lines in ts / tsx / mjs / css files under `apps/` and `packages/`. Exceptions are registered in `scripts/comment-discipline-allowlist.json` by `path`, full `line` and `reason`, and only for external quirks or public API docs. It runs as a separate advisory CI job and is not yet a required check.

When dispatching work to Codex / Grok / pi, use `docs/agent-dispatch-prompts.md`. The prompt must include: "Do not write comments; express intent through naming and code structure; exceptions follow the repository comment discipline. Write all repository content in English."

## Lessons ledger

When you make a mistake during a task and fix it, add or update a row in `docs/lessons.md` in its format in the same round; merge errors of the same kind, and merge lane conflicts by category. Take the highest feasible level on the ledger ladder; if a machine check is possible, add one. A new gate must use the real mistake as a negative control: confirm the old error goes red and the fix goes green.

Run `pnpm prepush` before pushing; it selects checks by changed paths, and docs-only changes skip code checks (the language gate still runs). CI uses the same entry point; dead-class stays a separate advisory check, and full e2e stays in four shards.

## Dependencies & Install Security

- Lockfile `pnpm-lock.yaml`: **confirm before committing it**. Unless it is the legitimate lockfile diff that comes with a dependency change, treat it as a mistake (`git reset pnpm-lock.yaml` to unstage). For an authorized legitimate change, the only way past the gate is `CAIRN_ALLOW_LOCKFILE_CHANGE=1 git commit ...` (matching pi's `PI_ALLOW_LOCKFILE_CHANGE`; accepts `1`/`true`/`yes`); the pre-commit lockfile gate offers no other exit.
- `pnpm install` locally; CI uses `pnpm install --frozen-lockfile`.
- Before adding a third-party package, check the deny list in `biome.json`: simple-git / isomorphic-git and similar are replaced by seam discipline; **do not install them again**.
- Do not run postinstall scripts unless the user explicitly allows it.

## Git

The repository has one remote: `origin = xiechimon/cairn` (the canonical repo; open PRs here). The former upstream (craft-ai-agents/craft-agents-oss, a reference source when the project started) was removed on 2026-09-29; do not add it back.

Commit conventions:
- Format: `<scope>(<ticket>): <subject>` or `web(<PR>): <subject>`. Scope follows existing usage (`web` / `daemon` / `server` / `shared` / `integration` / `docs` / `chore`, etc.); the subject is short and to the point, in English.
- Append the PR or issue number at the end: `(#123)` for a PR.
- **Closing keywords go in the commit message, not the PR body**: end with a line `closes #N` (for several issues write `closes #N1, closes #N2`; they cannot be combined). A squash merge carries only the **commit message** into main; the PR body never enters the commit, so a keyword only in the PR body does nothing and the issue stays OPEN (477/478/479/480 all hit this; again #487/#488 on 2026-09-30). Control measurement (2026-09-30, #495): with no keyword in the PR body and the keyword only in the commit message, the merge closed the issue as COMPLETED. Add the line to the commit message before opening the PR.
- **Closing keywords in a negated sentence still fire**: GitHub's keyword parser **ignores negation**. A sentence like "does not closes #417" still closes #417 when the merge lands. Measured 2026-09-30: Map #417 was closed this way by the squash commit of PR #522 (the timeline attaches the closed event to that commit), when the sentence was meant to say "do not close it". To say "this PR does not close an issue", **drop the verb**: write "unrelated to #417", and make sure no "closing keyword + issue number" shape appears anywhere in the commit message. As above, this only applies on the commit message channel; the PR body does not enter the commit.
- **Commit only files you changed**. Use explicit paths, `git add <path1> <path2>`; **never `git add -A` / `git add .`**, because several lanes (agents or humans) may share the same cwd. Exception: a merge commit after resolving conflicts stages everything by nature, so `git commit --no-edit` may finish the merge without another add (the merge state carries its own index); a hand-simulated merge committed as a normal commit is not covered.
- Never `git commit --no-verify`.
- When a pre-commit gate blocks an intentional change, the only exit is that gate's explicit environment variable: lockfile gate `CAIRN_ALLOW_LOCKFILE_CHANGE=1`, banned-vocabulary gate `CAIRN_ALLOW_BANNED_VOCAB=1` (both accept `1`/`true`/`yes`); there is no other exit.

- **Acceptance must check the PR body's permanent raw evidence links**: before merging, grep the body for `raw.githubusercontent` links pointing at this branch's `docs/verify/<ticket>/`; if missing, send it back (measured 2026-10-13 on #1297/#1294: the lane did not submit evidence and the orchestrator only looked at the gates).
- **The squash subject/body comes from the full commit message**: `messageHeadline` in `gh pr view --json commits` is a **truncated first line** (with an ellipsis); using it as `--subject` lands the truncated line in main. Use REST instead: `gh api repos/xiechimon/cairn/pulls/<n>/commits -q '.[0].commit.message'`, then split the first line from the rest (measured 2026-10-13 on #1289: the subject landed as "…claude-code m…").

Worktrees (cairn is designed for many lanes, hence the emphasis):
- **Create worktrees with absolute paths**: `git worktree add /Users/xmon/Code/AgentProjects/cairn/.claude/worktrees/<name>`. A relative path plus cwd drift (after a heredoc or `cd`) nests the worktree inside `apps/web/src/.claude/worktrees/`, where the vite watcher triggers a reload storm that kills the dev server.
- Branch lanes from `origin/main` (local main is often behind). When PRs collide on merge order, merge only when GitHub reports CLEAN; on conflict, rebase and re-verify.
- **Commit before handing off mid-task** (an M7 lesson): before a worktree changes hands (main line ↔ lane or lane ↔ lane), commit what you have. Uncommitted work gets overwritten by the next person's `merge --abort` or merge attempt and cannot be recovered (during the M7 merge phase, one round of drizzle conflict resolution for #309 was lost this way).
- **Drizzle migration numbering**: concurrent tickets that add tables will collide on sequence numbers. The number is always taken from the tail of main **at merge time**; lanes do not reserve a fixed number during development (tickets do not hard-code it), and on conflict at merge time renumber to main's tail + 1.

Git blocks (shared by autoresearch and pre-commit):
- `git reset --hard` / `git checkout .` / `git clean -fd` / `git stash`: **do not run**; they destroy other lanes' work.
- `git branch -D` / `git restore` are blocked by a hook inside the autoresearch loop; use `git branch -d` / `git worktree remove --force` instead.
- Never `--force` push.

## Issues and PRs

**Write PR bodies by following `.claude/skills/pr-cairn/SKILL.md`** (this repo's six-section contract What/Verified/Upstream/Risk/Acceptance/Issues; the `pr-evidence` gate checks the literal section names). **The global `/pr` skill (show-me's three sections Summary/Evidence/Merge Danger) does not pass the gate here.** A personal skill with the same name takes precedence over a project skill and the repo cannot take over the name `pr`, so the canonical skill here is `pr-cairn` (#1110, decided after four lanes hit the same trap).

**Run `/code-review` on your own branch before opening a PR** (Skill `code-review`, reviewing this branch's diff against `origin/main`): fix confirmed findings before opening the PR; for findings you decide not to fix, write a one-line reason in the PR body's Risk section. Run it again after pushing code fixes during the PR and before merging. When adding or rewriting a lot of code (new files, refactors, large new logic), follow up with `/simplify`. Skip both for docs-only changes. Green gates and green e2e do not mean the change is fine: on #1412 (2026-10-20) the gates and the full e2e suite passed, and `code-review` still found three things to fix: a new spec missing from the `e2e-affected` family table, the `drive-stop` "start" selector (`开始`) falsely matching the new chip word `待开始`, and wrong queued-chip semantics.

**Also run `/security-review` when touching security-sensitive surfaces** (Skill `security-review`): if the diff touches any of the following, run it before opening the PR in addition to `/code-review`. Fix confirmed findings; for findings you decide not to fix, write the reason in the PR body's Risk section and ask the user by name in the PR to confirm; do not let it through on your own.
- Keys and encryption: `apps/server/src/lib/{secret-box,keys,token-auth,attachments-token}.ts`, `apps/server/src/services/{secrets,credentials,api-keys,webhook-tokens,oauth}.ts`
- Machine registration and dispatch protocol: `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts`, `apps/daemon/src/{credentials,secret-channel,shell-channel,machine-client}.ts`, `apps/daemon/src/backend/command-gate.ts`
- MCP auth and external entry points: `apps/server/src/services/{mcp-face,mcp-servers}.ts`, `apps/server/src/routes-webhook.ts`

**Human decisions before a merge are expressed with a label, not in chat**: before asking the user anything about a PR (acceptance wording, conflict trade-offs, whether to merge), do these in order: `gh pr merge <n> --disable-auto` (takes effect synchronously; disarm first) → `gh pr edit <n> --add-label needs-decision`. `pr-evidence` is a required check on main (pinned to the GitHub Actions app): it goes red when it sees this label, and while the label is on, every run disarms the PR's auto-merge (including when someone re-arms it); it also adds the label itself when Acceptance has unchecked items. Removing the label is a human action: on GitHub, or by an agent with the prefix `CAIRN_DECIDED=1` after the user gave the decision in chat (otherwise the local PreToolUse hook blocks it; `gh pr merge --admin` is no way out). After removal, re-arm auto-merge with `gh pr merge <n> --squash --auto`. Editing the body to turn the gate green is not the decision landing: while the label is on, the check stays red. Origin: on 2026-10-21 #1435 was auto-merged before the user's decision landed; the orchestrator had checked the Acceptance boxes itself while asking the user, and pr-evidence was only advisory then.

**Review PRs with `docs/pr-review.md`** (#1080): a five-step process plus a fixed six-section scorecard (What it does / Good / Bad / Ugly / Tests / Open questions). "**Read the diff without switching branches**" is a hard requirement: use `gh pr view` / `gh pr diff` / `gh api` / `git show <ref>:<path>`, never `gh pr checkout`. Many lanes run in parallel here, each in its own worktree, and a reviewer's checkout collides with another lane's state. The only exception is the evidence dimension of the `pr-gate` workflow and its refuter: only in their own separate worktrees (never in the shared clone), with hooks off via `git -c core.hooksPath=/dev/null checkout --detach <headSha>`, and never checking out a head from a fork; see the `pr-gate` exception section in `docs/pr-review.md`.

The repository has only origin (xiechimon/cairn), so bare `gh` commands resolve correctly; the explicit `-R xiechimon/cairn` form still works:
- `gh issue list -R xiechimon/cairn`
- `gh pr view 149 -R xiechimon/cairn`
- `gh repo view` does not support `-R`; use the positional argument: `gh repo view xiechimon/cairn`

Opening a PR from a worktree lane:
```sh
gh pr create --repo xiechimon/cairn --head xiechimon:<branch>
```
A bare `--head <branch>` once failed with `Head sha can't be blank` in the two-remote era (head ref resolution went wrong with worktrees and multiple remotes); it has not been re-tested with a single remote, so keep the fully qualified form. Fix a PR opened with an empty body with `gh pr edit <n> --title --body-file /tmp/pr.md`.

PR bodies and long issue comments: **write a temporary file and use `--body-file`**; do not inline multi-line markdown in `--body`.
- **Read back after editing**: `gh pr edit <n> --body-file ...` can be interrupted by gh's Projects-classic GraphQL error and **not apply** (measured on #550: the command errored and the body stayed old). Use `gh api -X PATCH repos/xiechimon/cairn/pulls/<n> --input -` instead (JSON generated by a script to avoid shell escaping), then pull it back with `gh pr view <n> --json body` and compare byte for byte.
- **Screenshots and evidence for a PR must be committed to the branch**: Multica attachment URLs are not readable anonymously (`static.multica.ai/...` → `403 MissingKey`, `/api/attachments/<id>/download` → `401`), so embedding them in a PR body renders broken images; and a PR body can only embed URLs, which local files do not have. By convention, commit them to the task branch under `docs/verify/<ticket>/` and reference `https://raw.githubusercontent.com/xiechimon/cairn/<sha>/<path>` in the body (the repo is public; raw is anonymously readable). A local copy is only a backup, not a channel.

## User Override

The rules in this file can be overridden when they conflict with a user instruction, but **only after explicit user confirmation** ("I agree to break the No X rule because Y"). Carry out only the confirmed part.

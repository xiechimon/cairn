# The agent pushes and opens PRs as the GitHub App cairnwright

Issue #1666. Goal: pushes and PRs made on behalf of dispatched work no longer use ian's (xiechimon's) identity, so that after enabling "Require review from Code Owners" ian can approve PRs opened by the App. This document records facts only.

## The App and the bot user

- App: `cairnwright`. The original name `cairn-bot` was taken by an existing GitHub account; `cairn-bot-xmon` was used first, and it was renamed to `cairnwright` on 2026-10-25.
- App ID `5462173`, installation ID `174994433`.
- Installed only on the single repository `xiechimon/cairn`.
- Permissions: Contents, Pull requests, Issues, Workflows read/write; Metadata read-only. No webhook.
- Bot user: `cairnwright[bot]`, id `347615582` (`gh api /users/cairnwright%5Bbot%5D --jq .id`, with `[` `]` written as `%5B` `%5D`).
- Noreply email: `347615582+cairnwright[bot]@users.noreply.github.com`.

## Private key

- File: `~/.cairn/cairnwright.private-key.pem`, mode 600.
- Read only inside processes on this machine: never copied, never committed to the repo, never printed, never handed to an agent.

## The token-swapping tool

Lives outside the repo at `~/.cairn/tools/app-token/`; the repo gains no dependency.

- `token.mjs`: written with GitHub's official `@octokit/auth-app` (v8). Reads `~/.cairn/cairn-bot.json` (fields `appSlug`, `appId`, `installationId`, `privateKeyPath`) and exchanges for a one-hour installation token.
- `as-bot.sh <command>`: calls `token.mjs` to swap a token, places it only in that command's process environment, and then `exec`s the command:
  - `GH_TOKEN`: for `gh`.
  - git's http extraheader: injected through the `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` environment variables, never through command-line arguments. `credential.helper` is also cleared so pushes do not go through `gh auth git-credential`.
  - git author and committer: `GIT_AUTHOR_*`, `GIT_COMMITTER_*` set to `cairnwright[bot]` and the noreply email above, read from `packages/shared/commit-identity.json`.
  - `CAIRN_COAUTHOR`: defaults to `Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>`, which `as-bot.sh git commit` adds as a trailer; set it to an empty string for autonomous work nobody instructed.
- gh's global default account is still xiechimon; neither `gh auth login` nor `gh auth switch` has been run.

Usage:

```sh
~/.cairn/tools/app-token/as-bot.sh git commit -m "<scope>(<ticket>): <subject>"
~/.cairn/tools/app-token/as-bot.sh git push origin HEAD:<branch>
node scripts/lib/github-create-gate.mjs ~/.cairn/tools/app-token/as-bot.sh gh pr create --repo xiechimon/cairn --head <branch> ...
```

## Measured

On 2026-10-25 the App pushed a test branch and opened PRs (#1670 under the old name, #1672 under the new one): the PR author shows `app/cairnwright` (`is_bot=true`) and the commit author is `cairnwright[bot]`. Both test PRs have been closed and the branches deleted.

## What was switched

Now going through `as-bot.sh` (the dispatching side):

- Pushing.
- Opening PRs (`gh pr create`).
- Merge preparation follows the identity checks below; merge authorization uses the human login.

Agent sessions on this host (Claude Code, Codex, pi) commit and push through `as-bot.sh` as well. The repository's pre-commit hook rejects a commit made in an agent session (`agentEnv` in `packages/shared/commit-identity.json`) unless both its author and committer are `cairnwright[bot]`, and the pre-push hook rejects an agent pushing any commit not authored by `cairnwright[bot]`.

Claude Code cloud sessions are the exception (ian, 2026-11-10). The private key never leaves this host, so a cloud container cannot mint an App token. A cloud session commits with plain git as `Claude <noreply@anthropic.com>`, the identity its container is configured with, and pushes with the session's own repository credential. `cloudAgents` in `packages/shared/commit-identity.json` lists that identity: the pre-commit hook accepts an agent commit whose author and committer are both the App or both a cloud identity, the pre-push hook accepts commits a cloud identity authored, and `commit-author` accepts them on a branch of this repository when the committer is a cloud identity, the App, ian, GitHub or Mergify. A fork cannot carry the identity. Cloud sessions committed this way before the allowlist (11 commits on 2026-10-21).

Measured on #3851 (2026-11-10): a PR a cloud session opens through the GitHub connector is opened by `xiechimon`, the account the connector is linked to, not by an App. Every PR merges by squash and the squash commit is authored by the PR opener, so a cloud-opened PR lands on `main` authored by ian, which the allowlist accepts. It also means such a PR is ian's own on GitHub: he cannot approve it. Not measured yet: the `commit-author` run on `main` after the first such merge.

Other scripts that write to the remote should likewise prefix their commands with `as-bot.sh` when they need the App identity: `scripts/cleanup-merged-branches.sh` (`git push origin --delete`, `gh pr list`).

Not switched:

- `scripts/dispatch-agent.mjs`: only `spawn`s the commands given to it; it never commits, pushes, or opens PRs.
- `scripts/dispatch-dedupe.mjs`: read-only duplicate checks via `gh pr list --repo xiechimon/cairn` and `git ls-remote --heads origin`, using xiechimon's gh login.
- `~/.local/bin/ai-route` (symlinked to `~/.agents/automation/ai-route/ai-route.py`): only spawns `codex app-server`, pi, and grok child processes; no git commit, git push, or gh calls.
- `GITHUB_TOKEN` in CI: belongs to none of these identities.

Merging, approving, and label changes — operations that need a human identity — still use xiechimon's gh login and never go through the App token.

## Commit identity

There is one software identity on this host: `cairnwright[bot]`; a Claude Code cloud session commits as the cloud identity described above. Every other commit made by software — cairn steps, the Coordinator, host scripts and agent sessions — is authored and committed by it with plain git, and pushed like any other commit, with the repository's hooks. Only commits ian types himself carry his identity. When ian instructed the work, the commit carries `Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>`; product steps honour the team's `coAuthorTrailer` setting, and autonomous or scheduled work carries no human trailer.

Where the identity is decided: the server reads the App identity from `CAIRN_GITHUB_APP_SLUG` and `CAIRN_GITHUB_APP_BOT_ID` (`docs/configuration.md`) and hands it to the daemon in the step token; no token is minted for it, so an unconfigured or failing App token socket does not change the author. Before a step push, the daemon rewrites every unpublished commit of the step to that identity and adds the trailer (`attributeStepCommits`); the push credential never changes the author. Recovery branches commit as the App identity. Host scripts read it from `packages/shared/commit-identity.json` (`bot-identity.mjs`), and `lanes/sign-commits.sh` rewrites lane commits since main the same way. A cairn server with no App identity configured commits as `localCommitIdentity` (`<name> <cairn@localhost>`), and commits an agent made keep their author. This repository's hooks and `commit-author` reject that identity, and the pre-commit message names the two server settings: a cairn server working on this repository must set them. This host sets them in `~/.config/cairn/server.env` (`cairnwright`, `347615582`).

Commits are not signed: no path creates commits through the GitHub API, so there is no temporary ref, no second upload and no token-dependent author.

`commit-author` (`.github/workflows/commit-author.yml`, `scripts/commit-identity.mjs ci`) is an allowlist over `BASE_SHA..HEAD` for PRs and `BEFORE_SHA..HEAD` for main pushes (`HEAD^!` when the previous SHA is missing or all zeros). A commit passes when it is authored by `cairnwright[bot]`, ian or a cloud session identity and committed by the App, ian, a cloud session identity, GitHub or Mergify, on a branch of this repository (`HEAD_REPO` equals the repository; a fork cannot carry either identity, because only the App and ian can push here); or when it is a Mergify queue merge. Anything else fails, including the retired regular user `Cairnwright`, synthetic identities and either identity claimed from a fork.

Every PR merges by squash; the squash commit is authored by the PR opener, so App-opened PRs land on main as `cairnwright[bot]`.

- Both paths require a pr-gate go with `mergedBy: 'auto-merge'` (path class does not route to ian), no unchecked tasks anywhere in the body and no `coordinator-hold` label. After merging, verify the resulting main commit's author and its `commit-author` Actions result.
- A protected-path or security-surface PR, including one that used to be owner-routed and one opened by `cairnwright[bot]`, uses that same queue. Path class does not add `coordinator-hold`. A security surface also needs `/security-review` findings fixed or recorded in Risk before merge, and required CI plus a Codex cloud review with no unresolved P0/P1 on the head. `pr-evidence` fails a security-surface head that lacks `Security review (<sha>): fixed` or `Security review (<sha>): recorded`.

The regular GitHub user `cairnwright` is no longer used by anything; whether to keep or delete it is ian's decision.

## Token constraints

- One-hour expiry; exchanged fresh each time, never cached.
- Never written to a file, never committed to the repo, never logged, never put into PR or issue text; this document contains no token value.
- Neither the token nor the `.pem` is handed to an agent process: token swapping and pushing are done by the dispatching side through the command prefix.

## Code Owners review

`.github/CODEOWNERS` sets the owner of `integration/eval/**`, `.claude/hillclimb/**`, and the CODEOWNERS file itself to `@xiechimon`. Path class does not route those PRs to ian or add `coordinator-hold` (ian, 2026-11-11). The eval ruler stays protected so no PR can edit what judges it (`AGENTS.md`, "Merge routes"). pr-gate runs the origin/main copy, so a PR cannot edit the gate that judges it.

"Require review from Code Owners" is to be enabled only after the App can open PRs. Reason: if the PR author is xiechimon, ian cannot approve his own PR, and the owner in CODEOWNERS is also xiechimon — once enabled, PRs touching these paths would never obtain a valid code-owner review. For PRs opened by the App the author is `cairnwright[bot]`, which ian can approve. App-opened PRs were measured working on 2026-10-25.

Conditions and how to enable:

- Condition: #1669 merged into main, and ian personally confirms.
- Setting: `required_approving_review_count=0` plus `require_code_owner_reviews=true`. This way only PRs touching CODEOWNERS paths need ian's approval; other PRs require no review.
- Before changing it, save a snapshot of the current main branch protection so it can be rolled back.

## Create traffic throttle

Run bot issue, PR, and issue-comment creation through the repository wrapper:

```sh
node scripts/lib/github-create-gate.mjs ~/.cairn/tools/app-token/as-bot.sh gh issue create --repo xiechimon/cairn --title Example --body-file /tmp/issue.md
node scripts/lib/github-create-gate.mjs ~/.cairn/tools/app-token/as-bot.sh gh pr create --repo xiechimon/cairn --head branch --body-file /tmp/pr.md
node scripts/lib/github-create-gate.mjs ~/.cairn/tools/app-token/as-bot.sh gh issue comment 123 --repo xiechimon/cairn --body-file /tmp/comment.md
```

The server issue creation path and this wrapper reserve attempts in the same
`~/.cairn/github-create/state.json` sliding window. Set `CAIRN_HOME` identically
for both processes when overriding the home directory. Defaults are 3000 ms
between attempts and 300 attempts per rolling hour. Configure
`CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS` and `CAIRN_GITHUB_CREATE_HOURLY_CAP`
consistently across callers. Delays log their reason and duration. Failed attempts
also consume slots so errors cannot produce an unthrottled burst.

Only explicit rate-limit responses retry, at most three times after the initial
attempt, with increasing waits. REST honors Retry-After seconds or dates and
x-ratelimit-reset; the CLI honors Retry-After when gh includes it in stderr,
otherwise secondary limits wait at least a minute. Network failures and ordinary
permission failures are returned without replaying a potentially successful create.
Keep reads, updates, commit statuses, pushes, and merges outside this wrapper.
The external token wrapper is not modified by this repository; dispatchers must
use this prefix for create commands. Acquire happens before token exchange.

State writes use a lock directory and atomic rename. A process killed during a
state transaction can leave the lock behind; acquisition fails closed after
30 seconds rather than bypassing the cap. Inspect and remove an abandoned lock
only after confirming no process is using it. Invalid state fails closed as well.
Clock rollback retains future reservations and delays creation conservatively.

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
  - git author and committer: `GIT_AUTHOR_*`, `GIT_COMMITTER_*` set to `cairnwright[bot]` and the noreply email above.
- gh's global default account is still xiechimon; neither `gh auth login` nor `gh auth switch` has been run.

Usage:

```sh
~/.cairn/tools/app-token/as-bot.sh git push origin <branch>
node scripts/lib/github-create-gate.mjs ~/.cairn/tools/app-token/as-bot.sh gh pr create --repo xiechimon/cairn --head <branch> ...
```

## Measured

On 2026-10-25 the App pushed a test branch and opened PRs (#1670 under the old name, #1672 under the new one): the PR author shows `app/cairnwright` (`is_bot=true`) and the commit author is `cairnwright[bot]`. Both test PRs have been closed and the branches deleted.

## What was switched

Now going through `as-bot.sh` (the dispatching side):

- Pushing.
- Opening PRs (`gh pr create`).
- Merge preparation follows the identity checks below; merge authorization uses the human login.

The agents (codex, pi, grok) themselves never commit and never push.

Other scripts that write to the remote should likewise prefix their commands with `as-bot.sh` when they need the App identity: `scripts/cleanup-merged-branches.sh` (`git push origin --delete`, `gh pr list`).

Not switched:

- `scripts/dispatch-agent.mjs`: only `spawn`s the commands given to it; it never commits, pushes, or opens PRs.
- `scripts/dispatch-dedupe.mjs`: read-only duplicate checks via `gh pr list --repo xiechimon/cairn` and `git ls-remote --heads origin`, using xiechimon's gh login.
- `~/.local/bin/ai-route` (symlinked to `~/.agents/automation/ai-route/ai-route.py`): only spawns `codex app-server`, pi, and grok child processes; no git commit, git push, or gh calls.
- `GITHUB_TOKEN` in CI: belongs to none of these identities.

Merging, approving, and label changes — operations that need a human identity — still use xiechimon's gh login and never go through the App token.

## Merge identity

The GitHub App identity opens PRs and authenticates pushes. The Git author on main is a separate identity. The `commit-author` workflow rejects `cairnwright[bot]` in any checked commit's author name or email. PRs check `BASE_SHA..HEAD` from the PR base to its explicit head. Main pushes check `BEFORE_SHA..HEAD`; when the previous SHA is missing or all zeros, the check falls back to `HEAD^!` (the tip only).

Read the PR opener and all commit authors with `gh pr view <n> --json author,commits` before choosing the merge method.

- Bot-opened PRs require exactly one commit authored by `Cairnwright` before a rebase merge. Check that neither its author name nor email contains `cairnwright[bot]`. Use the dispatcher's `~/.cairn/tools/merge-pr.sh` after inspecting its source and usage on the dispatch host. If the helper is unavailable or authorship is wrong, return the PR to the dispatcher for preparation.
- Human-opened PRs use `gh pr merge <n> --squash --auto` after checking that none of their commit authors contains `cairnwright[bot]`.
- Both paths require a pr-gate go with `mergedBy: 'auto-merge'` (every other PR goes to ian), fully checked Acceptance and no `needs-decision` label. After merging, verify the resulting main commit's author and its `commit-author` Actions result.

Squashing a bot-opened PR can attribute the main commit to the bot opener even when the branch commit has the required author. Rebase preserves the prepared commit's author. A later green push checks its own pushed range; historical bot commits outside that range are excluded, and their authorship remains unchanged.

This repository documents the external helper contract. Its implementation is outside this checkout and must be inspected separately before changing dispatcher behavior.

## Commit preparation

App authentication authorizes remote operations; Git authorship records who prepared the commit. Do not prepare commits with `as-bot.sh` or `as-bot-author.sh`. The latter helper sets bot author and committer identities. Prepare commits outside both wrappers. Explicit environment assignments below override inherited author and committer names and emails, including values exported by a parent dispatcher:

```sh
GIT_AUTHOR_NAME=Cairnwright \
GIT_AUTHOR_EMAIL=348051526+cairnwright@users.noreply.github.com \
GIT_COMMITTER_NAME=Cairnwright \
GIT_COMMITTER_EMAIL=348051526+cairnwright@users.noreply.github.com \
git commit --file COMMIT_MSG.txt
git log --format='%H author: %an <%ae> committer: %cn <%ce>' origin/main..HEAD
```

Check every commit in that range before pushing: neither its author name nor email may contain `cairnwright[bot]`; its committer name and email must also be free of that identity. Bot-opened PRs still require the single prepared commit and rebase path above. The token wrapper remains the authentication path for pushes and PR creation.

## Recovery after a rejected main push

Preserve main history. Prepare and merge the correction through the identity checks above. A subsequent compliant push checks `BEFORE_SHA..HEAD`, excluding historical violations outside its own pushed range. When `BEFORE_SHA` is missing or all zeros, the workflow checks `HEAD^!`. PR validation checks every commit in `BASE_SHA..HEAD`, including a forbidden author beneath a compliant tip.

Read the resulting main commit's author and its `commit-author` Actions result after the merge. A green result establishes compliance for the checked range; it does not repair `b667fc4d133208d7650b66906d4be97a01939615` or any other historical commit. Keep the author gate unchanged. Dispatcher enforcement belongs to the external helper; this checkout cannot establish its implementation or which bypass caused the merge.

## Token constraints

- One-hour expiry; exchanged fresh each time, never cached.
- Never written to a file, never committed to the repo, never logged, never put into PR or issue text; this document contains no token value.
- Neither the token nor the `.pem` is handed to an agent process: token swapping and pushing are done by the dispatching side through the command prefix.

## Code Owners review

`.github/CODEOWNERS` sets the owner of `integration/eval/**`, `.claude/hillclimb/**`, and the CODEOWNERS file itself to `@xiechimon`. The merge gate already routes these paths to human review (`.claude/**` and `.github/**` are on the protected list; `integration/eval/**` is outside the auto-mergeable set).

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

## Incident recovery commit preparation

For #2101, prepare the reviewed correction outside both identity wrappers. This recovery procedure supersedes the historical bot-wrapped commit example above. App authentication for pushes and PR creation remains separate from commit authorship. Repository configuration alone cannot override inherited author or committer environment variables.

```sh
GIT_AUTHOR_NAME=Cairnwright \
GIT_AUTHOR_EMAIL=348051526+cairnwright@users.noreply.github.com \
GIT_COMMITTER_NAME=Cairnwright \
GIT_COMMITTER_EMAIL=348051526+cairnwright@users.noreply.github.com \
git commit --file COMMIT_MSG.txt
```

Keep the reviewed message and its co-author trailers. Verify the resulting author and committer with `git log -1 --format='%an <%ae>|%cn <%ce>%n%B'`. Bot-opened PRs still require exactly one Cairnwright-authored commit and the verified external helper's rebase route. Do not squash a bot-opened PR to recover this incident.

The dispatcher must use this preparation command for the correction, verify the helper on the dispatch host, and inspect the actual main commit after the authorized merge. Then read the subsequent main push's `commit-author` Actions result. A compliant new push range can pass while the historical rejected commit remains intact; rerunning the historical failed range still fails. Until both main metadata and the later green run are recorded, #2101 recovery remains pending. Local fixtures cannot establish external helper enforcement or main acceptance.


For #2136, the same recipe applies. Main tip `78b85594328fe2c26680060d1ad9dfa28e97d76b` and prior `c683123a69b8737ba7f2dac4cf404408e4cd4d5d` were authored as `cairnwright[bot]` after GitHub squash auto-merge of bot-opened PRs whose branch tips used the allowed `Cairnwright` identity. Preserve both historical commits and do not force-push main. Prepare one compliant correction outside both identity wrappers, keep co-author trailers, and merge by the identity-aware rebase route when the PR opener is the App. Until both the resulting main commit metadata and a later green `commit-author` Actions run are recorded, #2136 recovery remains pending. Local fixtures and this documentation change alone do not establish production recovery.

The trusted main push step in `.github/workflows/commit-author.yml` runs `scripts/commit-author-recovery.test.mjs`. It executes this recipe with inherited bot identity in an isolated Git repository, preserves co-author trailers and historical commit bytes, and checks both the subsequent push range and the rejected historical range using the workflow shell.

### Incident #2136

The rejected main commit is `c683123a69b8737ba7f2dac4cf404408e4cd4d5d`, authored by `cairnwright[bot] <347615582+cairnwright[bot]@users.noreply.github.com>`. The [failed commit-author job](https://github.com/xiechimon/cairn/actions/runs/40801882028/job/123211659439) checked `3d76fe37f04d5cce9b9a5305bea3c68dc727859e..c683123a69b8737ba7f2dac4cf404408e4cd4d5d`. The rejection is correct; retain the workflow shell and historical commit unchanged.

Use the recovery preparation recipe above, preserve co-author trailers, and verify the PR opener and every commit author before the later authorized merge. A bot-opened PR requires exactly one prepared Cairnwright commit and rebase through the inspected external helper. The dispatcher bypass responsible for this incident has not been established from this checkout.

Production acceptance remains pending: record the resulting main commit's author and committer, its SHA, and the subsequent main push's green `commit-author` Actions URL before declaring recovery. Local fixture success verifies the recipe and checked ranges only. It does not establish dispatcher enforcement or production recovery; rerunning the original rejected range must still fail.

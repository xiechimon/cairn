# Host development uses the owner's GitHub login

Authorized agent work on this host commits as `xiechimon` and uses the owner's existing `gh` login for GitHub access. Use ordinary `git commit` and `git push origin HEAD:main`, following `AGENTS.md`. Do not mint an App installation token for development.

Use the owner's registered noreply identity, `xiechimon <157263579+xiechimon@users.noreply.github.com>`. Author and committer must both be owner identities. The repository's pre-commit check accepts them in agent sessions; `commit-author` already accepts them on branches of this repository. Cloud sessions may continue using `Claude <noreply@anthropic.com>`. Forks cannot claim these identities.

## Existing worktrees and commands

Before making another commit in an older active worktree, fetch and integrate current `origin/main`, then run `pnpm exec husky` and check that `.husky/_/pre-push` exists. Its pre-commit script and shared identity checker must also be current. Coordinate conflicts with the worktree's owner; do not overwrite another session's changes. The owner updates only active trees, not abandoned ones.

Existing `cairnwright[bot]` commits remain accepted during migration. Preserve their authors and unpublished work rather than rewriting history. An old commit can still display the bot as its author even when a user pushes it: commit authorship and push authentication are different facts.

The installed `~/.cairn/tools/app-token/as-bot.sh` path remains temporarily for older callers. After installation of this revision it retains the command allowlist, but uses the owner's noreply identity and local user `gh` credentials. It does not call `token.mjs`, read a private key, mint a token, or add an automatic self co-author trailer. It clears inherited `GH_TOKEN`/`GITHUB_TOKEN` and the GitHub authorization extraheader, and selects `gh auth git-credential` with the owner's normal `~/.config/gh` directory. Explicit `CAIRN_COAUTHOR` trailers are still honored.

`bot-identity.mjs` is also a compatibility filename: its first two lines now identify the owner. `lanes/sign-commits.sh` is a compatibility no-op and never rewrites commits. New callers use ordinary git/gh, not these paths.

The compatibility allowlist retains the ship protections: ordinary fast-forward pushes to main are allowed; force, force-with-lease and delete pushes remain refused. The real pre-push hook checks main ancestry and deletion without rerunning the full validation suite. GitHub's remote branch protection remains independent.

Already running processes may retain their original environment. Do not kill them or take away their credentials. Notify their owning threads to finish naturally and update their own worktrees before their next commit or push.

## Product migration and App settings

This host change does not migrate the server, daemon, product publication credentials or GitHub MCP connections. Those belong to the owner-identity v2 and MCP workstreams. Do not inject the owner's host credentials into a product agent or use them as a product fallback.

The intended shared Device Flow App is the existing `cairnwright` registration, after its bot/private-key consumers have been retired and its settings have been verified. Do not delete that registration. Keep the temporary `Cairn xiechimon` registration until the final switch has passed verification and its deletion is separately approved.

Private-key removal requires a precise inventory and separate approval after all consumers, including running steps and infrequent jobs, have stopped using it. Keeping the App registration does not authorize retaining a bot publishing path. Neither this development change nor its installation changes port 8787, product dispatch, server environment or running services.

## Code Owners

`.github/CODEOWNERS` names `@xiechimon` as owner of `integration/eval/**`, `.claude/hillclimb/**` and the CODEOWNERS file itself. Commits go straight to `main`, so it is not enforced as a review; the rule that no change may edit what judges it lives in `AGENTS.md`.

## GitHub create traffic

Keep the existing creation throttle for issue, PR and issue-comment creation, using user `gh` directly:

```sh
node scripts/lib/github-create-gate.mjs gh issue create --repo xiechimon/cairn --title Example --body-file /tmp/issue.md
node scripts/lib/github-create-gate.mjs gh pr create --repo xiechimon/cairn --head branch --body-file /tmp/pr.md
node scripts/lib/github-create-gate.mjs gh issue comment 123 --repo xiechimon/cairn --body-file /tmp/comment.md
```

The wrapper and server share `~/.cairn/github-create/state.json`; keep `CAIRN_HOME` and rate-limit settings consistent. Reads, updates, statuses, pushes and merges stay outside the create wrapper. Authentication changes do not authorize any new external write.

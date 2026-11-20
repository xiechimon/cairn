# Host development uses the owner's GitHub login

Authorized agent work on this host commits as `xiechimon <157263579+xiechimon@users.noreply.github.com>` and uses the owner's existing `gh` login for GitHub access. Use ordinary `git commit` and land work with `node scripts/ops/push-queue.mjs`, following `AGENTS.md`. Do not mint an App installation token for development.

The allowlist lives in `packages/shared/commit-identity.json`; existing `Claude <noreply@anthropic.com>` and `cairnwright[bot]` commits stay accepted and are not rewritten — preserve their authors. Git hooks are not installed, so run verification explicitly before pushing; nothing formats or restages changes automatically.

## GitHub create traffic

Keep the existing creation throttle for issue, PR and issue-comment creation, using user `gh` directly:

```sh
node scripts/lib/github-create-gate.mjs gh issue create --repo xiechimon/cairn --title Example --body-file /tmp/issue.md
node scripts/lib/github-create-gate.mjs gh pr create --repo xiechimon/cairn --head branch --body-file /tmp/pr.md
node scripts/lib/github-create-gate.mjs gh issue comment 123 --repo xiechimon/cairn --body-file /tmp/comment.md
```

The wrapper and server share `~/.cairn/github-create/state.json`; keep `CAIRN_HOME` and rate-limit settings consistent. Reads, updates, statuses, pushes and merges stay outside the create wrapper.

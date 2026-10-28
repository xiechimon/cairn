# Issue #2028 verification

The implementation addition is `scripts/commit-author.test.mjs`, extended here with
range fixtures. It executes the workflow's actual author-check shell against temporary
Git repositories. `scripts/commit-author-policy.test.mjs` came from merged PR #2025 and
keeps its assertions; each of its fixtures now starts from a baseline commit so a bot
commit from one fixture cannot leak into the next.

`red.log` records the first test-first run against the previous head-only check.
`green.log` records all twelve passing after the range change. Fixtures cover the exact
rejected identity, bot name and email independently, human and Cairnwright authors, a
bot committer, a bot-authored commit beneath a human tip, a squash-shaped bot commit,
and a clean multi-commit range.

## What the check measures

The workflow checks every commit in `pull_request.base.sha..HEAD` on a pull request and
every newly pushed commit in `github.event.before..HEAD` on a push. When before is
absent or all zeros, it checks `HEAD^!` (the tip only). Historical bot commits are
excluded, while a bot-authored non-tip commit in a normal push fails. It reads
`git log` author fields only and executes no PR-provided code. `actions/checkout` is
pinned to a full commit SHA with a trailing version comment, matching the other
workflows (#1076); permissions stay `contents: read` with `persist-credentials: false`.

## What it cannot measure

The check can only see commits that exist when it runs. A squash merge writes a new
commit after the check has passed, so a green run cannot attest the author main will
receive. Measured: PR #1828 head `595ee1fc` was authored by `xiechimon` and its squash
result `51cab1f0` was authored by `cairnwright[bot]`, the same shape as the offending
`4bbfe50e`. The failure `4bbfe50e` is rejected by this range check when its own range
`4bbfe50e^..4bbfe50e` is fed to it (`author: cairnwright[bot] <347615582+...>`), and the
human commit `5adc14e4` in `5adc14e4^..5adc14e4` contains no bot author.

Preventing the squash path needs merge-path enforcement, which lives in the external
`~/.cairn/tools/merge-pr.sh`; that file is outside this worktree and was neither
inspected nor changed. The step's failure message says so and directs the reader to
check the main commit author after merging.

## Scope

The bot-author predicate is unchanged. Bot-opened PRs require one Cairnwright-authored
commit and a rebase; human-opened PRs use squash, per `docs/ops/agent-bot-identity.md`
and `.claude/skills/pr-cairn/SKILL.md` (both owned by merged PR #2025 and open PR #1848,
left untouched). Historical commit `4bbfe50e` is intact and main is not rewritten.

Round 2 negative controls are recorded in `round2-red.log` and `round2-green.log`.
The unchanged command `node --test scripts/commit-author.test.mjs scripts/commit-author-policy.test.mjs`
first failed four push fixtures, then passed all 17 tests. These exercise the actual
workflow shell with a human root and bot squash tip, a bot beneath a human tip,
historical bot commits outside the push, and missing or zero before SHAs. This
restores post-merge detection of squash author rewriting; PR checks still cannot
predict the author of a future squash commit. Actual GitHub recovery remains
unverified until a subsequent compliant main push runs the workflow.

Local checks passed: the English-only, single-use-helper and comment-discipline gates
each reported zero. Heavy checks ran serially under `flock /tmp/cairn-heavy.lock`.
No server was started.

# Reviewed delivery identity

The replacement delivery index was checked against the complete tree of reviewed commit `c0d53010` before adding this process record. The tree hashes are identical. All product code, tests, fixtures and existing evidence are preserved.

The GitHub CLI account was measured as `xiechimon`. The repository permits squash and rebase, requires up-to-date checks, and does not require code-owner approval. The replacement PR is opened through that current account with one commit. The original bot-opened PR remains available as review history.

The main `commit-author` workflow rejected `4bbfe50ea7bfb734672a6d74230d48f24b3012e4` because GitHub attributed the squash to the bot opener. That historical commit and failed run are unchanged. The existing dispatcher merge helper was read, not modified: it requires a current independent review, and bot PRs must have one commit authored by Cairnwright before rebase. No existing branch is rewritten by this delivery.

Additional changes after the equivalence check are this evidence record and the process lesson `docs/lessons/2024-bot-pr-squash-authorship.md`. Final product equivalence is checked again before commit.

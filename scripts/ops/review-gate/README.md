# Review gate

`.github/workflows/review-gate.yml` runs `codex-gate.mjs evaluate` (decision logic in `codex-gate-core.mjs`) on `pull_request_target`, on issue comments by `chatgpt-codex-connector[bot]`, and by hand through `workflow_dispatch` with the PR number. GitHub Actions has no event for resolving a review thread. It always runs the script from `main`, never executes PR code and uses no secrets. It writes one check run named `review-gate` per head SHA through the Checks API (the newest run of the `github-actions` app is updated, never duplicated).

The check reads the Codex state comment (`<!-- codex-review-state:v1 ... -->`, trusted only from the Codex bot) and the PR review threads:

- Review not finished for the head: in progress.
- Completed: success unless an unresolved Codex thread carries a P0 or P1 badge, outdated threads included. P2 and P3 never block.
- Failed: the workflow comments `@codex review` up to 2 times per head (marker `<!-- review-gate-retry:<sha>:<k> -->`); after that the check fails and the PR gets the `review-stalled` label.
- Allowance exhausted (the newest Codex comment is the usage-limit notice and is newer than the state comment): the check fails with `Codex allowance exhausted`, the PR gets `review-stalled`, and nothing is retried. Comment `@codex review` after the window resets.

Agents must resolve a Codex thread once its finding is fixed (GraphQL `resolveReviewThread`) and then comment `@codex review`: the re-review edits the Codex state comment, which re-runs the gate. An old thread stays blocking until it is resolved. Draft PRs, closed PRs, Mergify merge queue branches and authors without write access are skipped.

The host timer above is retired once Mergify requires the pinned `check-success = @github-actions/review-gate`.

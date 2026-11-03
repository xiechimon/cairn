# Review gate

`.github/workflows/review-gate.yml` runs `codex-gate.mjs evaluate` (decision logic in `codex-gate-core.mjs`) on `pull_request_target`, on issue comments by `chatgpt-codex-connector[bot]`, every 10 minutes on a schedule (`codex-gate.mjs sweep` dispatches the workflow for each open non-draft PR whose head check has not passed, so every evaluation of a PR runs in that PR's concurrency group), and by hand through `workflow_dispatch` with the PR number. GitHub Actions has no event for resolving a review thread, so the sweep picks that up. It always runs the script from `main`, never executes PR code and uses no secrets. It writes one check run named `review-gate` per head SHA through the Checks API (the newest run of the `github-actions` app is updated, never duplicated).

The check reads the Codex state comment (`<!-- codex-review-state:v1 ... -->`, trusted only from the Codex bot) and the PR review threads:

- Review not finished for the head: in progress. If Codex has not started a review of the head 10 minutes after the check was created (PRs opened before Codex was enabled get no automatic review on push), the workflow comments `@codex review` once per head (marker `<!-- review-gate-request:<sha> -->`).
- Completed: success unless an unresolved Codex thread carries a P0 or P1 badge, outdated threads included. P2 and P3 never block.
- Failed: the workflow comments `@codex review` up to 2 times per head (marker `<!-- review-gate-retry:<sha>:<k> -->`); after that the check fails and the PR gets the `review-stalled` label.
- Allowance exhausted (the newest Codex comment is the usage-limit notice and is newer than the state comment): the check fails with `Codex allowance exhausted`, the PR gets `review-stalled`, and nothing is retried. Comment `@codex review` after the window resets.

Agents must resolve a Codex thread once its finding is fixed (GraphQL `resolveReviewThread`); the next sweep, within 10 minutes, re-evaluates the PR. Commenting `@codex review` instead re-runs the gate as soon as Codex edits its state comment. An old thread stays blocking until it is resolved. Draft PRs, closed PRs, Mergify merge queue branches and authors without write access are skipped.

The host timer above is retired once Mergify requires the pinned `check-success = @github-actions/review-gate`.

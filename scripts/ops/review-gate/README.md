# Review gate

`.github/workflows/review-gate.yml` runs `codex-gate.mjs evaluate` (decision logic in `codex-gate-core.mjs`) on `pull_request_target`, on issue comments by `chatgpt-codex-connector[bot]`, every 10 minutes on a schedule (`codex-gate.mjs sweep` dispatches the workflow for each open non-draft PR whose head check has not passed, so every evaluation of a PR runs in that PR's concurrency group), and by hand through `workflow_dispatch` with the PR number. GitHub Actions has no event for resolving a review thread, so the sweep picks that up. It always runs the script from `main`, never executes PR code and uses no secrets. It writes one check run named `review-gate` per head SHA through the Checks API (the newest run of the `github-actions` app is updated, never duplicated).

The check reads the Codex state comment (`<!-- codex-review-state:v1 ... -->`, trusted only from the Codex bot) and the PR review threads:

- Review not finished for the head: in progress. If Codex has not started a review of the head 10 minutes after the check was created (PRs opened before Codex was enabled get no automatic review on push), the workflow comments `@codex review` once per head (marker `<!-- review-gate-request:<sha> -->`).
- Code review completed: success unless an unresolved Codex thread carries a P0 or P1 badge, outdated threads included. Ordinary code-review P2 and P3 findings do not block. A thread on a still-current right-side line range that contains no added line and sits in no hunk that removes lines is pre-existing: it is listed in the check summary and does not block. Outdated threads, left-side threads, files whose diff GitHub omits and threads without a location always block.
- Convergence: the first evaluation of a head that is blocked by P0/P1 threads comments `<!-- review-gate-block:<sha> -->` once. The marker count is the block round. From round 3 the title and summary tell the author to name the bug class, fix every instance or change the approach, and the PR gets the `review-gate-human` label once per head; the check stays red until the threads are resolved, so the cap never turns a block into a pass. A pass reports how many blocked heads preceded it (cycles to pass).
- Failed: the workflow comments `@codex review` up to 2 times per head (marker `<!-- review-gate-retry:<sha>:<k> -->`); after that the check fails and the PR gets the `review-stalled` label.
- Allowance exhausted (the newest Codex comment is the usage-limit notice and is newer than the state comment): the check fails with `Codex allowance exhausted`, the PR gets `review-stalled`, and nothing is retried. Comment `@codex review` after the window resets.

Agents must resolve a Codex thread once its finding is fixed (GraphQL `resolveReviewThread`); the next sweep, within 10 minutes, re-evaluates the PR. Commenting `@codex review` instead re-runs the gate as soon as Codex edits its state comment. An old thread stays blocking until it is resolved. Draft PRs, closed PRs, Mergify merge queue branches and authors without write access are skipped.

## Security review (D84)

The gate reads the `credentials`, `machineAndCommandBoundary` and `externalEntryAuth` categories from `packages/shared/merge-gate-paths.json` in the trusted main checkout. Any changed filename or previous filename matching those patterns requires a separate Codex SECURITY review. Deleted security files and renames out of a security surface remain covered. An incomplete or unavailable PR file list fails the check.

Only the latest summary marker from `chatgpt-codex-connector[bot]` with GitHub author type Bot is trusted. Its `security_review` must have `commit_sha` equal to the PR head, `status` equal to `completed`, and `has_unresolved_findings` strictly equal to `false`. Missing, stale, running, failed, malformed or unknown states fail closed. A newer incomplete summary supersedes an older approval. A completed `code_review` alone cannot qualify these paths.

Every unresolved security finding blocks, including Medium findings, regardless of the built-in `codex-security-review:v1` metadata's `mergeGateEnabled` or `blockingSeverityThreshold`. A clean security review supplements the normal code-review requirement. Request `@codex security review`, fix and resolve every security finding, and ask ian if no security review arrives within 30 minutes. There is no later Claude security rerun.

The sweep re-evaluates security-surface PRs even if their check previously passed, so deploying the stricter policy replaces old approvals and observes subsequent security-state updates. Ordinary PRs retain the existing code-review rules. Draft, closed, queue and non-write-author PR exclusions still apply.

The retired host timer is replaced by Mergify's pinned `check-success = @github-actions/review-gate`.

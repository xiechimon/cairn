# Single batch merger

`scripts/batch-merger.mjs` is the only merger for batch PRs in `xiechimon/cairn`: branches matching `^B\d+/`, such as `B1/work` or `B12/work`. These branches come from goal sessions, independently of product builds. Do not arm GitHub auto-merge or run another merger for them. Stopping this merger means nothing merges automatically on batch branches. Recovery PRs carrying `cairn-recovery` always wait for the owner in phase 1.

Every batch PR must carry the `review-gate` label; the goal-batch skill adds it. The review timer only selects PRs touching protected paths, carrying that label, or coming from `lane/<n>`. The merger logs `skip` with reason `no-review-label` when a batch PR lacks the label.

Each pass disarms every armed batch PR before considering a merge. Auto-merge armed between passes can fire before the next pass. A branch ruleset on `B*/` that blocks merges by anyone but the merger closes this gap; that ruleset is not set up here. It does not merge and posts no queue comments: an eligible PR enters the Mergify merge queue automatically once its `review-gate` status and `merge-route` pass, and re-enters after a new push. Never `gh pr merge` it. For each eligible PR the merger logs `auto-queue`. Eligibility checks the current head, main target, labels, draft state, required GitHub Actions checks, the newest `cairnwright[bot]` review comment marked for the current head (ordinary or carried-over PASS; a newer BLOCK wins), and the uncached pause marker. API errors fail closed. `--daily-cap <integer>` is still accepted so existing units keep running, and is ignored. Decisions are JSON lines on stdout; failures also set a nonzero exit code.

When pr-gate routing sends an otherwise eligible batch PR to the owner, the merger logs `owner-route` and surfaces it once per head: one comment starting with `<!-- batch-merger-owner-route:<headSha> -->` that lists the reasons, and the `owner-route` label (it must already exist in the repository; the merger never creates it). A second pass on the same head writes nothing; a new head gets a new comment. The coordinator polls `gh pr list --label owner-route`. The merger removes the label from a PR that is no longer owner-routed before logging `auto-queue`. Comment and label writes use the host's `gh` authentication; a failed write is logged as action `error` and sets a nonzero exit code. With `--dry-run` the merger logs `would-disarm`, `would-mark-owner-route` or `would-unmark-owner-route` and writes nothing.

Preview from the checkout with authenticated `gh` on PATH:

```sh
GITHUB_REPOSITORY=xiechimon/cairn node scripts/batch-merger.mjs --dry-run
node --test scripts/batch-merger.test.mjs scripts/autonomy-brake.test.mjs
```

The service and timer in `scripts/ops/systemd/` are templates and are not installed by this change. On the designated Linux merger host, put the checkout path, absolute Node executable, daily cap (passed to the ignored `--daily-cap` flag), and a PATH containing `gh` in `~/.config/cairn/batch-merger.env`:

```sh
CAIRN_CHECKOUT=/absolute/path/to/cairn
NODE_BIN=/absolute/path/to/node
BATCH_DAILY_CAP=10
PATH=/usr/local/bin:/usr/bin:/bin
```

Use the host's existing GitHub authentication, or a protected environment file with its configured token. Install the two units into `~/.config/systemd/user/`, run `systemctl --user daemon-reload`, then `systemctl --user enable --now cairn-batch-merger.timer`. The timer runs every five minutes; systemd serializes invocations of the same oneshot service. Do not run manual write passes concurrently with the service or install a second instance on another host.

Inspect decisions with `journalctl --user -u cairn-batch-merger.service`. Stop scheduling with `systemctl --user disable --now cairn-batch-merger.timer`; stop any active pass with `systemctl --user stop cairn-batch-merger.service`. For an immediate global brake, open an issue labelled `autonomy-paused` through the autonomy-brake workflow. Closing that issue resumes eligibility; a failed marker lookup never permits a merge.

# Single batch merger

`scripts/batch-merger.mjs` is the only merger for batch PRs in `xiechimon/cairn`: branches matching `^B\d+/`, such as `B1/work` or `B12/work`. These branches come from goal sessions, independently of product builds. Do not arm GitHub auto-merge or run another merger for them. Stopping this merger means nothing merges automatically on batch branches. Recovery PRs carrying `cairn-recovery` always wait for the owner in phase 1.

Every batch PR must carry the `review-gate` label; the goal-batch skill adds it. The review timer only selects PRs touching protected paths, carrying that label, or coming from `lane/<n>`. The merger logs `skip` with reason `no-review-label` when a batch PR lacks the label.

Each pass disarms every armed batch PR before considering a merge. It merges at most one PR, after checking the current head, main target, labels, draft state, required GitHub Actions checks, the newest `cairnwright[bot]` review comment marked for the current head (ordinary or carried-over PASS; a newer BLOCK wins), the UTC daily cap, and the uncached pause marker. API errors fail closed. The default cap is 10; all batch PRs with today's UTC `merged_at` count, including owner merges, so the cap is conservative. Squash messages retain every commit body, including closing keywords. Decisions are JSON lines on stdout; failures also set a nonzero exit code.

Preview from the checkout with authenticated `gh` on PATH:

```sh
GITHUB_REPOSITORY=xiechimon/cairn node scripts/batch-merger.mjs --dry-run --daily-cap 10
node --test scripts/batch-merger.test.mjs scripts/autonomy-brake.test.mjs
```

The service and timer in `scripts/ops/systemd/` are templates and are not installed by this change. On the designated Linux merger host, put the checkout path, absolute Node executable, daily cap, and a PATH containing `gh` in `~/.config/cairn/batch-merger.env`:

```sh
CAIRN_CHECKOUT=/absolute/path/to/cairn
NODE_BIN=/absolute/path/to/node
BATCH_DAILY_CAP=10
PATH=/usr/local/bin:/usr/bin:/bin
```

Use the host's existing GitHub authentication, or a protected environment file with its configured token. Install the two units into `~/.config/systemd/user/`, run `systemctl --user daemon-reload`, then `systemctl --user enable --now cairn-batch-merger.timer`. The timer runs every five minutes; systemd serializes invocations of the same oneshot service. Do not run manual write passes concurrently with the service or install a second instance on another host.

Inspect decisions with `journalctl --user -u cairn-batch-merger.service`. Stop scheduling with `systemctl --user disable --now cairn-batch-merger.timer`; stop any active pass with `systemctl --user stop cairn-batch-merger.service`. For an immediate global brake, open an issue labelled `autonomy-paused` through the autonomy-brake workflow. Closing that issue resumes eligibility; a failed marker lookup never permits a merge.

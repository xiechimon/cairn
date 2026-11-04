# #1440 — merge guard evidence (PR #1441)

Live demo on the guard PR itself; the workflow that ran is the one in the PR's merge ref.

- `required-checks-readback.json`: branch protection after the 2026-10-21 patch — four contexts, each `app_id` 15368 (GitHub Actions), `strict` true.
- `pr-1441-runs.txt`: the pr-evidence runs on the PR, with the decision lines of each.
  - run 39540474920 (opened): body had one unchecked Acceptance item on purpose; `pr-decision: needs-decision label added`.
  - run 39540555968 (auto_merge_enabled, after `gh pr merge --squash --auto` on the labelled PR): disarm failed with `GraphQL: Resource not accessible by integration (disablePullRequestAutoMerge)` — the token had `contents: read`. This is why the workflow now carries `contents: write` and fails the step on any disarm error.
  - run 39540637872 (synchronize, with `contents: write`): `pr-decision: auto-merge disarmed`.
  - the last run (synchronize): PR read from the API in one step; same verdicts.
- `pr-1441-timeline.json`: `labeled needs-decision by github-actions[bot]` 03:47:24Z, `auto_squash_enabled by xiechimon` 03:48:01Z, `auto_merge_disabled by github-actions[bot]` 03:49:18Z.
- `hook-tests.txt`: the machine-local PreToolUse hook exercised against the command shapes it blocks and passes.

Still to observe (a person's step): removing the label makes the next run green and `mergeStateStatus` leaves BLOCKED despite the earlier red runs on the same head.

# Orb trial-widen report

`trial-report.mjs` reads the product API and GitHub to produce one row per transferred issue. It never transfers tickets, starts work, retries a build, or changes GitHub state. Record real attempts only; test fixtures are not trial evidence.

Set `CAIRN_SERVER_URL` and `CAIRN_API_TOKEN` in the environment and authenticate `gh` for read access. Keep credentials outside the input and output files.

```sh
node scripts/ops/orb/trial-report.mjs docs/verify/2281/trial-widen.json
node scripts/ops/orb/trial-report.mjs --check docs/verify/2281/trial-widen.json
node scripts/ops/orb/trial-report.mjs --markdown docs/verify/2281/trial-widen.json
```

The default output is a JSON report with `ok`, `total`, `merged`, `rows` and `failures`. Each row retains attempt receipts: product build/todo/source identifiers, claimed execution step IDs/kinds/statuses, the enrolled machine ID and each counted PR's full merge SHA/time and main-reachability result. The top level retains the batch-end and canary timestamps. `--markdown` renders the reason table. `--check` exits 1 unless all acceptance checks pass. Without `--check`, an incomplete report is still printed with `ok: false`; this permits inspecting work in progress. Unreadable input always exits 1.

The input contains:

| Field | Required value |
| --- | --- |
| `repo` | `xiechimon/cairn` |
| `attempts` | Array of `{ "issue": 123, "buildId": "actual-product-build-id" }`; include every retry build for each selected issue. |
| `finishedAt` | Epoch milliseconds when the trial batch ended, after the included builds were created and counted PRs merged. |
| `reasons` | Object keyed by issue number, with `{ "code": "timeout", "detail": "Observed cause and evidence reference" }` for each issue without a verified merge. |
| `canary.checkedAt` | Epoch milliseconds when the post-trial isolation canary completed. Must be at least `finishedAt`. |
| `canary.result` | The complete JSON output saved from the post-trial `canary.sh --json` run on the reviewed runtime. |

Retries of an issue count once; duplicate build IDs for the same issue are deduplicated. A build ID shared between different issues is rejected. The checked report requires exactly 20 distinct issues and at least 10 verified merged outcomes.

For every attempt, the API build ID must match and its todo must have the matching GitHub `sourceRef`. At least one claimed `build` or `session` step must resolve to the team's unique enrolled machine named `omarchy-orb`; all claimed execution steps in that build must belong to it. Plan, review and merge steps cannot substitute for execution. Unclaimed failed setup attempts therefore do not satisfy the trial denominator acceptance.

The current GitHub issue must have `by:cairn` with no other `by:*` or `batch:*` ownership. A counted merged PR must be recorded by the product build, use that build's `cairn/conv-<buildId>` branch in the same repository, close the issue, and have its full merge SHA reachable from GitHub's current `main`. Its GitHub `merged_at` must be valid, at least the build creation time, and no later than `finishedAt`; a canary predating a known merge cannot pass through an earlier operator-supplied batch-end time. The issue must be closed as completed and the build must have completed execution on the Orb machine. A Thread with `awaitingReply: true` cannot count as a merged outcome, even if an earlier session step is done. Any API failure invalidates the report even if another retry merged.

Allowed reason codes are `setup_failed`, `orb_start_failed`, `agent_gave_up`, `review_blocked`, `ci_red`, `timeout` and `other`. Supply a nonempty explanation; the tool does not infer a cause from ambiguous logs. Fix evidence/API failures instead of classifying them as agent failures.

The post-trial canary must report `ok: true`, nonempty direct-read, symlink, socket/server and sudo-read route groups with every row in every supplied group `blocked: true`, clean pushed objects, a successful negative-object control, GitHub reachability and no remaining sentinels. The report consumes the canary's own completeness verdict; it does not rerun isolation probes or attest the operator's timestamps. Preserve the original capture and runtime receipts alongside the report. A green scratch canary from another batch does not prove this trial.

This report does not prove trial-one's dist/image identity, host workspace absence, original merge-trailer requirement, deployment, snapshot behavior, or provider enrollment. Those retain their separate acceptance evidence. Actual trial-widen execution waits for trial-one, the new runtime and Orb snapshot.

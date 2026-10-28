# Build-to-PR reliability loop (#1996)

Issue #1795 measured build-to-PR at 6/104 and was closed when the freeze was lifted without reaching the target. #1996 keeps that measurement alive on a repository that is not Cairn, so a regression in the pipeline cannot be hidden by Cairn's own task mix.

## The pieces

- `sample-tasks.json`: the fixed sample repository (`xiechimon/cairn-sample-ufo`, a mirror of `unjs/ufo` at tag `v1.6.4`) and 15 tasks pinned to `baseSha` `f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6`.
- `task-checks.md`: for every task, the command that shows today's behavior at the pinned base and its actual output, so no task asks for behavior that already exists and every bug task's failing input is real.
- `apps/server/src/reliability-report.ts`: the cause classifier and the report builder. `BUILD_CAUSES` is the cause table; `classifyBuildCause` assigns one cause to every failed build; `buildReplayReport` turns the day's replay file into the same report shape the live database produces.
- `apps/server/src/reliability-report-cli.ts`: the reporter. `--project` reads Cairn's own database, `--replay` reads a replay file.

## Daily run

Each day, every one of the 15 tasks is dispatched once against the sample repository at the pinned base. A task counts as reached-PR only when the pipeline opened a pull request; nothing else counts, and an operator cancel is recorded as `cancelled` and excluded from the cause table.

Record the day's builds as a replay file so the report is reproducible without the database:

```sh
pnpm rel:report --replay docs/reliability/1996/replay/2026-11-03.json \
  --repo xiechimon/cairn-sample-ufo \
  --base f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6 \
  --since 2026-11-03T00:00:00Z --until 2026-11-04T00:00:00Z
```

The command prints the JSON report, `---`, then the markdown table. The same report for Cairn's own builds, when the sample run needs a comparison:

```sh
pnpm rel:report --project <project-id> --since <ISO> --until <ISO>
```

### Replay file format

An array of entries. `repo`, `baseSha` and `createdAt` are required and are checked against the command's `--repo`, `--base` and window, so a replay recorded on another repository or another base cannot be reported as this sample's.

```json
[
  {
    "task": "ufo-08",
    "kind": "bug",
    "repo": "xiechimon/cairn-sample-ufo",
    "baseSha": "f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6",
    "buildId": "build-1",
    "todoId": "todo-1",
    "createdAt": "2026-11-03T10:00:00.000Z",
    "prNumber": 41,
    "errorMessage": null
  }
]
```

`task` must be one of the 15 checked-in ids when the caller supplies the set, and `prNumber` non-null is what makes an entry count as reached-PR.

## Weekly report

The weekly number goes to the weekly delivery metrics report (#1758) as one line: the sample repository's build-to-PR rate for the seven days, with the Wilson 95% interval the report already computes, plus the cause table for the same window. The acceptance target is above 50% for seven consecutive days by 2026-11-10.

## Status

This branch lands the measurement machinery: the sample repository and its 15-task set are checked in, and the reporter turns a day's builds into a rate, a Wilson interval and a cause table. The review-gate fix round hardened the replay path (secrets redacted, age counted against the window end) and taught the classifier the failures that live only in a failed step's `plan-residual-` message; the test-first evidence is under `docs/verify/1996/`. The remaining acceptance items cannot be produced inside this repository: the daily dispatch loop on omarchy (fork reset to `baseSha`, dispatching the 15 tasks, recording the replay file) is the orchestrator's next step, the weekly line for #1758 is that loop's `rel:report` output posted on schedule issue #1717, and the seven-day rate above 50% by 2026-11-10 is an open result that only those runs can show.

## Cause table

`classifyBuildCause` assigns exactly one cause per failed build:

| cause | what it means |
|---|---|
| `provider-network` | the provider or its relay failed to answer: connection errors, 429/503/529, capacity exhaustion, bare "Connection error." |
| `quota` | the account is out of credits or over its usage limit: 402, insufficient credit, billing |
| `timeout` | a step stream ran past its own time limit (`stream timeout (arm=...)`) |
| `git` | any git operation failed: push, commit, merge, fetch, clone, checkout, worktree |
| `unstaffed` | nobody was assigned to the plan slot, so no machine could ever claim the step |
| `unclaimed` | a pinned machine held an idle slot and never claimed the step within the claim window |
| `session-lost` | a continue step could not resume a session the machine never stored |
| `agent-gave-up` | a session ended with zero progress and no terminal outcome |
| `gate-or-phase-bug` | a quality gate or phase contract rejected the run's own output |
| `stuck-waiting` | no error and no PR six hours after the build started |
| `other` | none of the above; every entry here is a classifier gap to close before the next week |

Order matters: `timeout` is checked first because a step cut off past its stream limit prints the timeout marker and nothing else worth trusting, and `git` is checked before `provider-network` because a `git push` that fails on a socket prints both (`git push failed (128): ... unable to connect ...`) and the failure is still the git step's.

# Epic and batch completion manifests

Store one JSON manifest per batch at `.claude/epics/<epic>.json`.
`scripts/epic-done.mjs` reads it at the remote main SHA by default, so a run
cannot change its own finish line. Optional `--ref` must resolve to an ancestor
of remote main; checks still run at the remote main SHA.

## Manifest v2

The required fields are `epic` (matching the filename), `items`,
`requiredChecks`, `checks`, and `maxHours` (a positive finite hour limit).
`items` is non-empty, with unique string ids and positive, unique issue numbers.
Each item has `id`, `issue`, `dependsOn` (an array of item ids), and optional
boolean `humanHeld`. Dependencies must form an acyclic graph and reference
existing items. The v1 `issues` array remains supported in place of `items`;
it cannot be combined with `items`.

```json
{
  "epic": "example",
  "items": [
    { "id": "foundation", "issue": 2157, "dependsOn": [], "humanHeld": true },
    { "id": "followup", "issue": 2158, "dependsOn": ["foundation"] }
  ],
  "requiredChecks": ["check", "pack-smoke", "e2e-gate"],
  "checks": [{ "name": "checker-tests", "run": ["node", "--test", "scripts/epic-done.test.mjs"] }],
  "maxHours": 24
}
```

On main pushes, use `check`, `pack-smoke`, and `e2e-gate` as required CI checks;
`pr-evidence` only runs on pull requests.
Each `checks` entry is `{ name, run: argv[], expectStdoutIncludes? }`, with a
unique name and non-empty command argv. Commands run without a shell in a
throwaway worktree at remote main, with no `node_modules` installed by the
checker. Each must exit successfully and, if specified, include the expected
substring in stdout. Each command has a 900-second timeout.

## Evaluation

An item is `done` only when its issue is closed as completed and its closing
PR is merged with a merge commit reachable from main. The checker uses the
last closing event or the issue's closing PR references to find that PR.
A closed-not-planned issue is never done. For compatibility, v1 also accepts
a closing commit reachable from main without a PR.

Unfinished items marked `humanHeld`, carrying an owner-wait label, or linked
to an open PR carrying `needs-decision`, `waits-ian`, or `ready-for-human` are
`humanHeld`. Their dependents are `blocked` transitively. Other unfinished
items with unfinished dependencies are also `blocked`; unrelated items with
satisfied dependencies stay `ready`. Completed items do not remain held.
The batch pauses for owner work only when `ready` is empty and `humanHeld`
is non-empty.

Completion requires every item done, every required check successful on the
latest main SHA itself, and passing manifest commands. Only the newest check
run per required name (highest run id) counts. An older green SHA cannot
satisfy a red or pending latest main SHA.
Explicit `--fail reason` wins over `--pause reason`, which wins over an
exhausted time cap; the cap produces `failed`. These stop states win over
completion. Missing or malformed external facts produce `unknown`.

## Invocation and persisted state

Run `node scripts/epic-done.mjs example --state /tmp/example-state.json --json`
from the repository, with `gh` authenticated and remote main fetched locally.
The default state path is `~/.claude/plans/<epic>/state.json`.
`--started-at <ISO timestamp>` optionally seeds the first start time; later
runs preserve the persisted start regardless of that flag.

State is written atomically by renaming a sibling temporary file. It records
`phase`, `pauseReason`, `startedAt`, `activeHours`, `updatedAt`, and
`failureHistory` keyed by item id. Each unfinished observation appends its
time, status, and reasons to that item's history. The initial checkpoint
preserves the budget even if gathering facts subsequently fails.
Time between active (`incomplete` or `unknown`) observations accumulates;
time following `paused`, `complete`, or `failed` observations does not.
A rerun after a pause resumes evaluation without charging the paused interval.
A failed phase remains failed. Rerunning never resets counters or history.

JSON includes `state`, `items: [{ id, status, pr }]` (PR number or null),
`humanHeld`, `blocked`, `ready` (item ids), `mainSha`, `mainGreen`, and `reasons`.
It also retains `exitCode`, command `checks`, gathered `facts`, `greenSha`, and
`lastClosingSha` for existing consumers.
States and exit codes: `complete` 0, `incomplete` 10, `paused` 20, `failed` 30,
`unknown` 2.

This directory and the checker are protected paths; a person merges manifest
changes.

# Epic completion manifests

Store one JSON manifest per epic at `.claude/epics/<epic>.json`.
`scripts/epic-done.mjs` reads it at the remote main SHA by default, so a run
cannot change its own finish line. Optional `--ref` must resolve to an ancestor
of remote main; checks still run at the remote main SHA.

The required fields are `epic` (matching the filename), `issues` (non-empty,
unique positive issue numbers), `requiredChecks` (non-empty, unique check names),
`checks`, and `maxHours` (a positive finite hour limit).
On main pushes, use `check`, `pack-smoke`, and `e2e-gate` as required CI checks;
`pr-evidence` only runs on pull requests.

Each `checks` entry is `{ name, run: argv[], expectStdoutIncludes? }`, with a
unique name and non-empty command argv. Commands run without a shell in a
throwaway worktree at remote main, with no `node_modules` installed by the
checker. Each must exit successfully and, if specified, include the expected
substring in stdout. Each command has a 900-second timeout.

```json
{
  "epic": "example",
  "issues": [2157],
  "requiredChecks": ["check", "pack-smoke", "e2e-gate"],
  "checks": [{ "name": "checker-tests", "run": ["node", "--test", "scripts/epic-done.test.mjs"] }],
  "maxHours": 24
}
```

Run `node scripts/epic-done.mjs example --started-at 2026-10-29T00:00:00Z --json`
from the repository, with `gh` authenticated and remote main fetched locally.
`--started-at` enables the time cap; `--pause reason` and `--fail reason` supply
explicit stop reasons. States and exit codes: `complete` 0, `incomplete` 10,
`paused` 20, `failed` 30, `unknown` 2. Completion requires issues completed on
main, a green main commit after all closures, and passing manifest commands.

This directory and the checker are protected paths; a person merges manifest
changes.

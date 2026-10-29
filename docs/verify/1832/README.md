# 1832 escape eval loop

Parent ticket for the split stack #1952 / #1955 / #1956 / #1957. Those pieces
already collect candidates, resolve introducing PRs, classify review paths, and
export reviewer-bank cases. This change adds the end-to-end command that runs
them in order and writes the weekly report plus bank export for the review eval
loop.

## Command

```sh
node scripts/escape-eval-loop.mjs \
  --since 2026-10-15T00:00:00Z --until 2026-10-29T00:00:00Z \
  --out /tmp/escape-loop \
  --bank-out /tmp/escape-bank \
  --allow-network
```

`--respond-file` supplies recorded PR metadata for offline attribution. Without
`--allow-network` or a respond file, resolution stays offline.

## Red / green

- `red.log`: `node --test scripts/escape-eval-loop.test.mjs` before the
  orchestrator existed (3 failures: missing CLI, missing prepush step).
- `green.log`: the same command after the change (4 pass).

## Gates

- `lint.log`, `typecheck.log`, `spec-parse.log`, `helper-gate.log`.

## Live run on origin/main

Window `2026-10-15T00:00:00Z` .. `2026-10-29T00:00:00Z` with `--allow-network`
(summary in `live-summary.json`):

- 12 candidates on `origin/main`
- 4 resolved introducing PRs (not the fixing PR numbers)
- weekly report with path counts (`unknown` for the four qualifying events in
  this window; see `weekly-report.txt`)
- 16 verified bank cases exported to a temporary bank; empty ineligible reasons
  for the rest in `export-report.json`
- bank validation `ok: true`

Artifacts: `candidates.json`, `traces.json`, `weekly-report.json`,
`weekly-report.txt`, `export-report.json`, `validate-cases.json`.

## Overlap

Lookup on 2026-10-29 for terms `escape trace` / `1832` / `review escape weekly`
and paths `scripts/escape-trace.mjs`, `scripts/review-escapes.mjs`,
`integration/eval/review` found open parent #1832 and no open PR file overlap.
Merged splits #2060 / #2110 / #2134 / #2120 remain the leaf implementations;
this PR only composes them.

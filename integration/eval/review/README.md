# Reviewer bank cases

Versioned escape cases for the future reviewer benchmark (#1779). This directory
is a local export and validation surface only: no GitHub writes and no model
calls.

## Layout

- `case.schema.json`: versioned case schema (`version: 1`).
- `cases/`: verified bank. Only cases with resolvable immutable commits and
  file/line evidence belong here.
- `candidates.json`: traces that are not eligible for the verified bank, each
  with an `ineligibleReason`. Written by `export-cases`.

## Case shape

Every case keeps reviewer-visible input and answer labels in separate top-level
objects:

- `provenance`: original PR, fixing PR, introducing SHA, fixing SHA, replay base
  (parent of the introducing commit).
- `reviewerInput`: original PR number, introducing subject, and introducing
  commit diff. Must not contain defect labels, locations, or corrections.
- `answer`: defect path and line range, defect labels, and the known correction
  (fixing subject plus fixing patch for that path).
- `tracing`: resolution method, `evidenceSufficiency: "verified"`, replay
  limitations, and the source evidence object from the escape-trace JSON.

## Produce cases

Prefer the end-to-end loop from #1832. It collects candidates on `origin/main`,
resolves introducing PRs, writes the weekly review-path report, exports verified
cases into the bank, and validates the bank:

```sh
node scripts/escape-eval-loop.mjs \
  --since 2026-10-01T00:00:00Z --until 2026-10-28T00:00:00Z \
  --out /tmp/escape-loop \
  --bank-out integration/eval/review \
  --allow-network
```

Offline attribution uses `--respond-file` with recorded PR metadata instead of
`--allow-network`. Artifacts under `--out` are `candidates.json`, `traces.json`,
`weekly-report.json`, `weekly-report.txt`, `export-report.json`, and
`validate-cases.json`.

The stepwise commands remain available. `export-cases` consumes the trace JSON
array from #1955 (`status`, introducing and fixing SHAs, original/fixing PRs,
file/line evidence):

```sh
node scripts/escape-trace.mjs candidates --since 2026-10-01T00:00:00Z --until 2026-10-28T00:00:00Z \
  > /tmp/escape-candidates.json
node scripts/escape-trace.mjs trace --respond-file /tmp/escape-respond.json \
  < /tmp/escape-candidates.json > /tmp/escape-traces.json
node scripts/escape-trace.mjs export-cases --traces /tmp/escape-traces.json --out integration/eval/review
node scripts/review-escapes.mjs --traces /tmp/escape-traces.json --format text
```

Without resolved traces, pass a traces file of unresolved records. Export writes
`candidates.json` with an explicit `ineligibleReason` for each record and does
not create verified cases.

Only `status: "resolved"` traces with a fixing PR, a non-empty defect line
range, and a replayable introducing parent enter `cases/`. Unresolved,
multiple-origin, outside-window, missing provenance, empty locations, and
non-replayable histories stay in `candidates.json`.

Repeated export is deterministic: the same origin PR, fix SHA, path, and line
range map to one case id and rewrite the same bytes.

## Validate

```sh
node scripts/escape-trace.mjs validate-cases integration/eval/review/cases
```

Validation checks schema fields, forbidden reviewer-input keys, resolvable
SHAs, that the replay base is the introducing parent, and that the defect line
range exists in the introducing tree. The empty bank passes. Local prepush and
CI run the same command through `scripts/prepush.mjs`.

## Handoff for #1779

The reviewer benchmark runner is not required for this bank. When it lands:

1. Load each `cases/*.json`.
2. Feed only `reviewerInput` (plus any production review prompt wrapper) to the
   model under test.
3. Score the model output against `answer.defect` / `answer.labels` /
   `answer.correction` without revealing those fields in the prompt.
4. Use `provenance.replayBase` and `provenance.introducingSha` when a harness
   needs to materialize the introducing diff outside the stored `diff` string.

A detected fix is not itself a confirmed review miss. Only verified attribution
enters this bank; ambiguous candidates remain outside `cases/`.

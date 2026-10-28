# 1957 reviewer-bank export

## Red (tests first)

`node --test scripts/escape-trace.test.mjs` on origin/main before `exportCases` /
`validateCases` existed: see `red.log` (missing named exports).

## Green

Same command after this change: see `green.log`.

## Real repository export

`export-cases` against October 2026 fix candidates with unresolved attribution
(trace resolve from #1955 / #2110 not merged into this base): zero verified
cases; every candidate listed in `candidates.ineligible.json` with
`ineligibleReason: unresolved:missing-resolve-attribution`. Summary in
`export-report.json`. Empty bank validates: `validate-cases.log`.

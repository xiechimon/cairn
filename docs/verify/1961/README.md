# Verify #1961 — fail-closed page benchmark grading

Branch evidence for fail-closed `gradeRun` / `qualityPerCost` / `aggregateGrades`.

## Commands

```sh
pnpm --filter @cairn/integration exec vitest run test/page-bench-grade.test.ts
pnpm --filter @cairn/integration typecheck
pnpm lint
pnpm spec:parse
```

`test/page-bench-contract.test.ts` is not on `main` yet (#1960 / #2108). This lane grades against an injected bank fixture and does not import the unmerged question bank.

## Artifacts

| File | Role |
| --- | --- |
| `red.log` | Vitest before `grade.mts` existed (module missing) |
| `green.log` | 13/13 pass after implementation |
| `typecheck.log` | `@cairn/integration` tsc |
| `lint.log` | `pnpm lint` |
| `spec-parse.log` | Spec parse gate |

## Rubric rule stated in tests

Any non-empty `consoleErrors` makes the run `invalid` (never ignored; never scored as success).

## Schema fail-closed (review fix)

`gradeRun` validates the run-record shape (zod, matching `run-record.schema.json`) before scoring. Missing required fields, non-boolean `buildOk`, and null `requirements` are `invalid` and stay out of aggregates.

- `schema-red.log` — two new cases fail on the prior tip (malformed accepted as valid; null requirements throw)
- `schema-green.log` — 15/15 after schema validation

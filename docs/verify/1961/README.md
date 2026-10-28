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

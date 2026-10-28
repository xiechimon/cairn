# #1964 plan coverage evidence

## Red before implementation

`red-missing-grader.log`: `plan-grade.test.ts` / `plan-flow.test.ts` fail on main-shaped tree because `integration/eval/plan/grade.mts` is missing.

## Green acceptance

- `acceptance-integration.log`: plan-grade, plan-flow, harness-eval-result
- `acceptance-shared.log`: harness-eval (includes plan grader harness path)
- `acceptance-typecheck.log` / `acceptance-lint.log`

## Real runner artifacts

- `pass/`: shared runner against the no-split plan case with stub relay creating one matching todo → `plan_ok: 1`
- `fail/`: same prompt with assistant prose only (no todo artifacts) → `plan_ok: 0` (`empty artifacts`)

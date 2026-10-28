# #1964 plan coverage evidence

## Red before implementation

`red-missing-grader.log`: `plan-grade.test.ts` / `plan-flow.test.ts` fail on main-shaped tree because `integration/eval/plan/grade.mts` is missing.

## Green acceptance

- `acceptance-integration.log`: plan-grade, plan-flow, harness-eval-result
- `acceptance-shared.log`: harness-eval
- `acceptance-typecheck.log` / `acceptance-lint.log`

## Review-gate fix

Plan grader stays on `.claude/hillclimb/plan/_state.json` `harness_paths` only, not `CHIEF_DISPATCH_HARNESS_PATHS`.

- `gatefix-shared.log`: harness-eval asserts plan grader is absent from `CHIEF_DISPATCH_HARNESS_PATHS`
- `gatefix-integration.log`: plan-grade / plan-flow
- `gatefix-merge-gate.log`: chief-dispatch `_state.json` matches the constant item-for-item
- `gatefix-typecheck.log` / `gatefix-lint.log`

## Real runner artifacts

- `pass/`: shared runner against the no-split plan case with stub relay creating one matching todo → `plan_ok: 1`
- `fail/`: same prompt with assistant prose only (no todo artifacts) → `plan_ok: 0` (`empty artifacts`)

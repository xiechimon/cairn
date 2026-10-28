# Routing eval report

- Tasks: slugify (1)
- Planner model for the handoff arm: -
- Generated: 2026-10-28T17:50:14.630Z

Pass rate excludes plain errors; flagged errors count as failures in the denominator.
Cost cells show `unknown` when the persisted prices map has no rate for that model.

## Per model

| arm | model | runs | graded | pass | pass rate (95% CI) | cost USD mean (95% CI) | wall s mean (95% CI) | flagged | errors |
|---|---|---|---|---|---|---|---|---|---|
| single | stub-single | 1 | 1 | 1 | 1.000 [0.207, 1.000] | unknown | 0.3 [0.3, 0.3] | 0 | 0 |

## Flagged runs

- none

## Errors

- none

## Runs

| task | arm | model | planner | status | why |
|---|---|---|---|---|---|
| slugify | single | stub-single | - | pass | oracle passed |

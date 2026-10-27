# Routing eval report

- Bench: cairn-bench (1 task)
- Planner model for the handoff arm: stub-model
- Generated: 2026-10-26T17:59:02.909Z

Pass rate counts only graded runs (errors excluded); flagged runs count as failures.

## Per model

| arm | model | runs | graded | pass | pass rate (95% CI) | cost USD mean (95% CI) | wall s mean (95% CI) | flagged | errors |
|---|---|---|---|---|---|---|---|---|---|
| handoff | stub-model | 1 | 1 | 1 | 1.000 [0.207, 1.000] | - | 0.0 [0.0, 0.0] | 0 | 0 |
| single | stub-model | 1 | 1 | 1 | 1.000 [0.207, 1.000] | - | 0.1 [0.1, 0.1] | 0 | 0 |

## Planner overhead (handoff arm)

- planner model: stub-model
- runs: 1
- cost USD total: -
- wall s total: 0.0

## Flagged runs

- none

## Runs

| task | arm | model | status | why |
|---|---|---|---|---|
| slugify | single | stub-model | pass | oracle passed |
| slugify | handoff | stub-model | pass | oracle passed |

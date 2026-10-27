# Routing eval report

- Bench: cairn-bench (1 task)
- Planner model for the handoff arm: stub-model
- Generated: 2026-10-26T17:59:25.963Z

Pass rate counts only graded runs (errors excluded); flagged runs count as failures.

## Per model

| arm | model | runs | graded | pass | pass rate (95% CI) | cost USD mean (95% CI) | wall s mean (95% CI) | flagged | errors |
|---|---|---|---|---|---|---|---|---|---|
| single | stub-model | 1 | 1 | 0 | 0.000 [0.000, 0.793] | - | 0.1 [0.1, 0.1] | 1 | 0 |

## Flagged runs

- slugify / single / stub-model: /etc/hostname

## Runs

| task | arm | model | status | why |
|---|---|---|---|---|
| slugify | single | stub-model | fail | out-of-workdir reads: /etc/hostname |

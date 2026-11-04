# Routing eval report

- Tasks: slugify (1)
- Planner model for the handoff arm: stub-planner
- Generated: 2026-10-28T17:50:15.629Z

Pass rate excludes plain errors; flagged errors count as failures in the denominator.
Cost cells show `unknown` when the persisted prices map has no rate for that model.

## Per model

| arm | model | runs | graded | pass | pass rate (95% CI) | cost USD mean (95% CI) | wall s mean (95% CI) | flagged | errors |
|---|---|---|---|---|---|---|---|---|---|
| handoff | stub-exec-a | 1 | 1 | 1 | 1.000 [0.207, 1.000] | 0.0039 [0.0039, 0.0039] | 0.2 [0.2, 0.2] | 0 | 0 |

## Planner overhead (handoff arm)

- planner model: stub-planner
- runs: 1
- cost USD total: unknown
- wall s total: 0.0

## Flagged runs

- none

## Errors

- none

## Runs

| task | arm | model | planner | status | why |
|---|---|---|---|---|---|
| slugify | handoff | stub-exec-a | stub-planner | pass | oracle passed |

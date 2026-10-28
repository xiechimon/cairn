# Harness page benchmark

Same-model page-generation comparison across harnesses (pacman, Claude Code CLI, bare pi). Only the harness changes; prompts, budgets, and model stay fixed. Spec 29 phase E2, ticket #1532.

## Status

Question bank and evidence contract only. No runner or scorer in this directory.

Spec 29 E0 prerequisites are merged: #1511–#1514. Model tier choice remains pending owner approval before paid baseline runs (#1963).

## Contract files

| File | Role |
| --- | --- |
| `questions.json` | Versioned bank: prompts, requirement ids, interactions, desktop/mobile viewports, network policy |
| `run-record.schema.json` | Versioned run record shape, including per-requirement verdicts and viewport-tagged screenshots |
| `rubric.md` | Partial credit, build/console rules, incomplete evidence vs failed requirements, unavailable cost data |

## Follow-on tickets

- #1961 fail-closed machine grading against these requirement ids
- #1963 weak-tier bare-pi baseline (needs model approval)
- #1965 blinded judging and Langfuse calibration

Keep #1532 open until those land. Do not add `run.mts` or `grade.mts` placeholders here.

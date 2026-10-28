# #1987 — configuration-safe routing resume and per-model reports

Issue: resume keys omitted the planner model, so a different `--planner` could
reuse old handoff rows while the report relabeled them. There was also no
persisted experiment identity binding measurement-affecting configuration, and
no CLI/report layer on top of the #1986 session runner.

## What changed

- `integration/eval/routing/experiment.mts`: experiment identity (planner,
  executors, tasks, task/oracle digest, harness digest, reps, timeout,
  thinking, prices digest; no credentials), resume keys that include the
  planner, manifest load/save, incompatible-row diagnostics.
- `integration/eval/routing/report.mts`: Wilson / bootstrap aggregates, cost
  from persisted prices (`unknown` when missing), planner-overhead section,
  flagged/error sections.
- `integration/eval/routing/run.mts`: CLI with `--report-only`, resume gate
  before any model call, atomic publish of `experiment.json` + `results.jsonl`
  + `report.md`.
- `integration/test/routing-resume.test.ts`: identity, reject, report-only,
  and deterministic stub-relay resume coverage.

## Evidence

- `red.log` — new suite against a tree without `run.mts` / `experiment.mts` /
  `report.mts`: import failure (`Cannot find module '../eval/routing/run.mts'`).
- `green.log` — 9/9 passed after the change (~2s).
- `typecheck.log`, `lint.log`, `spec-parse.log` — clean.
- `overlap.txt` — no open PR on the changed paths.

## Base

Branched from `origin/main` at `933a3b6e`.

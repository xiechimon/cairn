# #1987 — configuration-safe routing resume and per-model reports

Issue: resume keys omitted the planner model, so a different `--planner` could
reuse old handoff rows while the report relabeled them. There was also no
persisted experiment identity binding measurement-affecting configuration, and
no CLI/report layer on top of the #1986 session runner.

Review-gate BLOCK on the first head (`0e6b26b7`) named three defects fixed here:
pricing digest collapsed nested rates, flagged errors vanished from the pass-rate
denominator, and acceptance-checklist v1 coverage/evidence was incomplete.

## What changed

- `integration/eval/routing/experiment.mts`: experiment identity in
  `manifest.json` (planner, executors, tasks, task/oracle digest, prompts
  digest, harness digest, reps, timeout, thinking, complete prices digest; no
  credentials), resume keys that include the planner, incompatible-row
  diagnostics.
- `integration/eval/routing/report.mts`: Wilson / bootstrap aggregates; flagged
  errors count as failures in the pass-rate denominator; cost from persisted
  prices (`unknown` when missing); planner-overhead section.
- `integration/eval/routing/run.mts`: CLI with `--report-only`, resume gate
  before any model call, byte-identical no-op when nothing is missing.
- `integration/test/routing-cli.test.ts`: checklist cases including pricing
  rejection, table-driven incompatible resume, grading success, real flagged
  run, and byte-identical compatible resume.

## Evidence

- `red.log` — suite against a tree without `run.mts` / `experiment.mts` /
  `report.mts`: import failure.
- `green.log` — 21/21 passed after the change.
- `typecheck.log`, `lint.log`, `spec-parse.log` — clean.
- `overlap.txt` — no open PR on the changed paths.
- `artifacts/clean/` — graded pass with `manifest.json` + report metrics.
- `artifacts/flagged/` — real forbidden-read failure in rows and report.
- `artifacts/compatible-resume/` — `ran=0`, zero relay delta, results unchanged.
- `artifacts/incompatible-resume/` — pricing change rejected before any relay
  request; `rejection.txt` names the prices digest conflict.
- `gen-artifacts.mts` — stub-relay script that regenerated the four artifact
  directories.

## Base

Branched from `origin/main` at `933a3b6e`; review-gate fix on tip of
`cursor/routing-resume-1987-e2a0`.

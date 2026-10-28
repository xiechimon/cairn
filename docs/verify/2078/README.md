# #2078 — atomic complete-run-only `--write-verify`

Issue: `run-eval.mts --write-verify` published schema-shaped evidence even when
cases failed, mixed cached `results.jsonl` rows into `decision_ok`, wrote the
destination file in place (interruptible), and accepted partial `--case` /
non-all `--arm` selections. The #1975 worker also gates on
`integration/test/write-verify.test.ts`, which was missing.

## What changed

- `integration/test/write-verify.test.ts`: vitest coverage for reject /
  fail / interrupt / stale-cache / success paths, plus the worker preflight
  existence check.
- `integration/eval/chief-dispatch/run-eval.mts`: reject partial selections;
  skip done-cache seeding under `--write-verify`; publish only when
  `fail === 0` and fresh rows cover the full suite; compute digests over
  fresh rows/traces only; write via hashed `.tmp` then `renameSync`.

## Evidence

- `red.log` / `red-summary.log` — new tests against `origin/main` run-eval:
  4 failed / 2 passed (failed and interrupted runs still overwrite the prior
  result; stale cached rows dilute `decision_ok` to ~0.33).
- `green.log` — same suite after the change: 6/6 passed (24s).
- `typecheck.log` — `pnpm --filter @cairn/integration typecheck` clean.
- `lint.log` — `pnpm lint` clean (one unrelated info elsewhere).
- `spec-parse.log` — `pnpm spec:parse` PASS.
- `overlap.txt` — overlap lookup at 2026-10-28T17:10:06Z; no open PR on the
  changed paths.

## Base

Rebased onto `origin/main` at `b9c5c55a`.

# #2078 — atomic complete-run-only `--write-verify`

Issue: `run-eval.mts --write-verify` published schema-shaped evidence even when
cases failed, mixed cached `results.jsonl` rows into `decision_ok`, wrote the
destination file in place (interruptible), and accepted partial `--case` /
non-all `--arm` selections. The #1975 worker also gates on
`integration/test/write-verify.test.ts`, which was missing. #1973 also requires
automated runs to use a new per-run directory so operator variant artifacts
stay byte-identical.

## What changed

- `integration/test/write-verify.test.ts`: recording relay; matching cached
  seed rows; full request-count assertion; interrupt after confirmed activity
  with `SIGTERM`; successful publish leaves no temp; existing variant bytes
  stay identical.
- `integration/eval/chief-dispatch/run-eval.mts`: reject partial selections;
  skip done-cache under `--write-verify`; write artifacts into a new
  `<variant>.wv-<pid>-<stamp>` per-run directory; publish only when the suite
  completes; digests over fresh rows/traces; hashed `.tmp` then `renameSync`.

## Evidence (review-gate BLOCK fix)

- `block-red.log` — strengthened tests against the pre-isolation runner:
  3 failed / 3 passed (matching seeds append into the operator variant;
  success digests still read `baseline/`).
- `block-green.log` — same suite after per-run isolation: 6/6 passed (~18s).
- `block-typecheck.log` — `pnpm --filter @cairn/integration typecheck` clean.
- `block-lint.log` — `pnpm lint` clean (one unrelated info elsewhere).
- `block-spec-parse.log` — `pnpm spec:parse` PASS.
- `block-harness-eval-result.log` / `block-harness-eval.log` — related schema
  suites still green.

## Earlier round

- `red.log` / `red-summary.log` / `green.log` — first atomic publish round.
- `typecheck.log` / `lint.log` / `spec-parse.log` / `overlap.txt` — first round.

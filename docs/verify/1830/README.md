# #1830 verification — routing eval (plan-handoff vs single model)

Implements GitHub issue #1830: a routing bench where a strong model writes the plan and
cheap pi models execute it, compared against one strong model doing the whole task, with
pass rate / cost / wall time per model and anti-cheat grading.

## What landed

- `integration/eval/routing/bench.mts` — the cairn-bench slice for routing: 21
  self-contained Node.js ESM coding tasks, each with a seeded stub, a hidden oracle
  script, and (4 of 21) a working decoy implementation a lazy executor could wrap.
- `integration/eval/routing/grade.mts` — grading: run the hidden oracle, flag
  out-of-workdir reads (read tool paths; bash read verbs resolved against the
  workdir with quote stripping, statement splitting on `&&`/`;`/`|`, command
  substitution, and `cd` to outside the workdir all detected), flag wrapped
  implementations (decoy path references or verbatim copies), Wilson 95%
  intervals for pass rate, deterministic bootstrap CIs for cost and wall time,
  per-model aggregation, markdown report. Each session is graded against its own
  workdir, so planner and executor reads are checked separately.
- `integration/eval/routing/driver.mts` — one pi session per step, driven through the
  `AgentBackend` seam (`apps/daemon/src/backend/pi.ts`), collecting text, tool calls
  and token usage.
- `integration/eval/routing/run.mts` — the runner CLI: arms `single` and `handoff`
  on the same task set and models, resumable `results.jsonl`, `report.md`,
  `--report-only`, prices from a JSON file, relay endpoint from
  `CAIRN_EVAL_RELAY_URL`/`CAIRN_EVAL_RELAY_KEY`. The handoff planner runs in its own
  seeded workdir, so its writes never reach the executor and its reads are graded
  like the executor's.
- `integration/test/routing-bench.test.ts` — written first, red before
  implementation. Covers: task-set validity, every oracle fails on the untouched
  stub (negative control), the word-wrap oracle accepts a greedy reference
  implementation, every decoy passes its oracle through a re-export wrapper and is
  detected as wrapped, a self-contained implementation passes and is clean,
  anti-cheat unit cases (including quoted paths, statement chains, command
  substitution and `cd` outside the workdir, with negative controls for the same
  shapes inside the workdir), Wilson/bootstrap math, aggregation and report
  content, and five end-to-end runs against a stub model (handoff clean pass,
  single arm on a real bench task, out-of-workdir read failing an otherwise passing
  run, a planner that writes the implementation still failing the oracle, a planner
  that reads outside its workdir failing the run).

## Acceptance mapping

- "Plan-handoff arm runs on cairn-bench next to the single-model arm" —
  `cli-smoke.log` + `cli-smoke/results.jsonl`: both arms over the `slugify` bench
  task through the real CLI (`run.mts`), planner session feeding the executor prompt.
- "Report shows pass rate, cost and time per executor model" —
  `cli-smoke/report.md`: per-model table with Wilson-interval pass rate, cost and
  wall time columns (cost shows `-` in the smoke because no `--prices` file was
  passed; the unit test covers cost math), planner overhead section.
- "Out-of-workdir reads and wrapped implementations are flagged and counted as
  failures" — `cli-smoke-snoop.log` + `cli-smoke-snoop/report.md`: a run whose
  executor read `/etc/hostname` passes the oracle but is graded `fail` with the read
  flagged; wrapped implementations are covered by the unit tests (decoy reference,
  import, verbatim copy) and counted as failures by `gradeTaskRun`.

## How to reproduce

```sh
pnpm exec vitest run integration/test/routing-bench.test.ts   # 25 tests

# CLI smoke against a scripted stub relay (needs a second terminal):
cd integration
pnpm exec tsx ../docs/verify/1830/stub-relay.mts        # prints the relay URL
pnpm exec tsx eval/routing/run.mts \
  --arms single,handoff --planner stub-model --executors stub-model \
  --tasks slugify --out /tmp/routing-smoke \
  --relay-url <url> --relay-key stub-key

pnpm exec tsx ../docs/verify/1830/stub-relay.mts snoop   # flagged-run variant
```

A live run with real models uses the same CLI with the team relay endpoint and a
prices file, for example:

```sh
pnpm exec tsx integration/eval/routing/run.mts \
  --planner glm-4.7 --executors kimi-k3,qwen3.8-max \
  --prices prices.json --out integration/eval/routing/results/baseline
```

## Gates

- `pnpm lint` — clean (`lint.log`).
- `pnpm typecheck` — all packages pass (`typecheck.log`).
- `node scripts/english-only-gate.mjs` — 0 lines.
- `node scripts/comment-discipline-gate.mjs` — 0 lines.
- `node scripts/single-use-helper-gate.mjs` — 0 helpers.
- `node scripts/prepush-vitest.mjs` — selected the new test file, 25/25 pass.

# #1968 plan revision benchmarks and planning coverage

## Metrics

- `plan_ok` (binary): single-turn cases use include/exclude/split bounds; revision cases require `mustFix` + `mustPreserve` and forbid `exclude` on the final persisted todo title+spec (assistant prose does not count).
- Revision arms: `feedback` seeds `priorPlan`, delivers rejection feedback, then grades the final board; `no-feedback` starts from an equivalent fresh stack without feedback. A harness failure is recorded in `errors.jsonl`, never as a control score.

## Acceptance status

Deterministic grader tests, labeled-slice negatives, tightened revision expectations, and the plan flow under `.claude/hillclimb/plan/` are in this PR. Planning is registered as flow `plan` and remains **built-not-run** until a real-model family run lands both arms.

`docs/verify/1968/baseline/` holds stub-relay smoke artifacts for runner wiring only. Those stub scores are **not** acceptance evidence and must not be copied into `.claude/hillclimb/plan/baseline/` as scored coverage. Real-model both-arm acceptance is unfinished; no cost approval was invented for a paid run in this lane.

Ticket #1968 stays open until a real-model family run produces both arms after an approved cost estimate. This PR must not carry a closing keyword for that ticket.

## Reproduction

```sh
pnpm --filter @cairn/integration exec vitest run \
  test/plan-cases.test.ts test/plan-grade.test.ts test/plan-revision.test.ts test/run-eval-resume.test.ts
node --test scripts/eval-coverage.test.mjs
node scripts/generate-feature-map.mjs && git diff --exit-code docs/feature-map.md
```

Real-model family (when credentials and an approved cost estimate exist):

```sh
pnpm exec tsx integration/eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/plan --variant baseline --model glm-5.3 \
  --arm all --reps 1 --concurrency 1 --timeout-s 1800 --approve-harness
```

## Labeled slice

`labeled-slice/` copies `integration/eval/plan/labeled-slice.json`: alias variation passes; Safari prompt-echo, missing fix, dropped preserve, backoff-without-jitter, and incomplete composite-index plans fail.

## #1516 candidates later

Confirmed failure-replay candidates from #1516 can become revision cases by copying ticket text into `prompt`, the rejected plan rows into `priorPlan`, the structured rejection into `feedback`, and naming fix/preserve alias groups that do not echo the ticket. This ticket does not require those candidates to exist yet.

## Overlap

Carries the single-turn plan runner slice from #1964/#2111 because main lacked those APIs at open time. Open PR #2111 targets the same foundation; merge order should land one then rebase the other.

# #1968 plan revision benchmarks and planning coverage

## Metrics

- `plan_ok` (binary): single-turn cases use include/exclude/split bounds; revision cases require `mustFix` + `mustPreserve` and forbid `exclude` on the final persisted todo title+spec (assistant prose does not count).
- Revision arms: `feedback` seeds `priorPlan`, delivers rejection feedback, then grades the final board; `no-feedback` starts from an equivalent fresh stack without feedback. A harness failure is recorded in `errors.jsonl`, never as a control score.

## Reproduction

```sh
pnpm --filter @cairn/integration exec vitest run test/plan-cases.test.ts test/plan-grade.test.ts test/plan-revision.test.ts
node --test scripts/eval-coverage.test.mjs
node scripts/generate-feature-map.mjs && git diff --exit-code docs/feature-map.md
pnpm exec tsx integration/eval/chief-dispatch/run-eval.mts \
  --flow .claude/hillclimb/plan --variant baseline --model glm-5.3 \
  --arm all --reps 1 --concurrency 1 --timeout-s 1800 --approve-harness
```

Family scores in this tree used a stub relay for CI-reproducible both-arm artifacts (`baseline/`). Paid real-model runs need an orchestrator cost estimate first.

## Labeled slice

`labeled-slice/` copies `integration/eval/plan/labeled-slice.json`: alias variation passes; Safari prompt-echo, missing fix, and dropped preserve fail.

## #1516 candidates later

Confirmed failure-replay candidates from #1516 can become revision cases by copying ticket text into `prompt`, the rejected plan rows into `priorPlan`, the structured rejection into `feedback`, and naming fix/preserve alias groups that do not echo the ticket. This ticket does not require those candidates to exist yet.

## Overlap

Carries the single-turn plan runner slice from #1964/#2111 because main lacked those APIs at open time. Open PR #2111 targets the same foundation; merge order should land one then rebase the other.

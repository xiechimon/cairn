# Verify #1944 — trustworthy prompt-set comparison report

## Red (before implementation)

`pnpm --filter @cairn/integration exec vitest run test/compare-prompt-sets.test.ts` failed because `compare-prompt-sets.mts` did not exist:

```
Error: Cannot find module '../eval/chief-dispatch/compare-prompt-sets.mts'
```

Full capture: `red.log`.

## Green (after)

```
pnpm --filter @cairn/integration exec vitest run test/compare-prompt-sets.test.ts
# 10 passed
pnpm typecheck
pnpm lint
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/compare-prompt-sets.mts \
  integration/test/fixtures/compare-prompt-sets/smoke --current current --cut cut
```

CLI Markdown: `cli-smoke.md`.

## Files

- `integration/eval/chief-dispatch/compare-prompt-sets.mts`
- `integration/test/compare-prompt-sets.test.ts`
- `integration/test/fixtures/compare-prompt-sets/smoke/`
- `integration/eval/chief-dispatch/harness-eval-result.mts` (widened `parseResultsJsonl` row type)

Does not touch `run-eval.mts`, `grade.mts`, or `prompt-set.mts` (#2107).

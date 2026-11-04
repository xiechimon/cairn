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
# 14 passed
pnpm typecheck
pnpm lint
pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/compare-prompt-sets.mts \
  integration/test/fixtures/compare-prompt-sets/smoke --current current --cut cut
```

CLI Markdown: `cli-smoke.md`. Capture: `brake-green.log`.

## Review-gate brake (#2114 / tip fix)

Findings on tip `d4b2d1b5` (comment tip `e190f560`):

1. `validateArms` only compared model + harness_sha; mismatched thinking/timeout_s and missing prompt_set_identity / arm / context_window / flow_digest were accepted.
2. `coverageWarnings` compared row counts, so reps `[0,1]` vs `[2,3]` produced no warning; duplicate `(prompt_id, rep)` could inflate counts.

Fix (tests first): full runner-contract validation via `sameRunnerConfig` / `provenanceComplete`; duplicate `(prompt_id, rep)` rejection; per-case rep-set coverage warnings. Smoke fixtures carry the full provenance fields.

## Files

- `integration/eval/chief-dispatch/compare-prompt-sets.mts`
- `integration/test/compare-prompt-sets.test.ts`
- `integration/test/fixtures/compare-prompt-sets/smoke/`
- `integration/eval/chief-dispatch/harness-eval-result.mts` (widened `parseResultsJsonl` row type)

Does not touch `run-eval.mts`, `grade.mts`, or `prompt-set.mts` (#2107).

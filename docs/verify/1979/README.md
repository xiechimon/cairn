# Verify #1979 — harness regression eval routing

Stacked on #2113 (`cursor/1977-harness-eval-attempts-dbbd`) for `claimAttempt` / attempt state.

## Commands

```sh
pnpm --filter @xiechimon/cairn exec vitest run test/merge-gate-harness-eval.test.ts test/merge-gate*.test.ts
pnpm --filter @cairn/shared exec vitest run test/harness-eval.test.ts test/snapshot.test.ts
node scripts/pr-gate-selfcheck.mjs
pnpm typecheck && pnpm lint
```

## Artifacts

| File | Role |
| --- | --- |
| `tests-red.log` | Suite against #2113 tip readiness/blocker vocabulary (4 fail) |
| `tests-green.log` | 8/8 harness-eval routing cases |
| `merge-gate.log` | readiness + status + coordinator + harness-eval |
| `typecheck.log` / `lint.log` / `spec-parse.log` | gates |
| `pr-gate-selfcheck.log` | protected-path selfcheck |

## Rule

`harness-regression-evaluating` is transient only while a live attempt exists. Missing, stale, and below-threshold stay human. #1865-style reclassification without dispatch is the named negative control.

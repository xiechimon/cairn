# Verify #1614 — harness regression auto-dispatch

## Scope

Parent RSI-2 ticket. Children `#1973` / `#1975` / `#1977` / `#1979` already landed
the atomic `--write-verify` path, result-only worker, attempt store with digest
dedupe and timeout escalation, and readiness routing that dispatches on
`harness-regression-missing` / `harness-regression-stale` while a live attempt
exists (`harness-regression-evaluating`), keeping `below-threshold` as human.

This change closes the parent by putting the remaining server-side dispatch
tooling (`apps/server/src/services/harness-eval-*.ts`) into
`PROTECTED_PATH_GLOBS`, matching the issue requirement that dispatch logic stay
outside the auto-merge set. Threshold `0.924` and missing/stale/below-threshold
blocker classes are unchanged.

## Commands

```sh
pnpm --filter @xiechimon/cairn exec vitest run \
  test/merge-gate-harness-eval.test.ts \
  test/harness-eval-coordinator.test.ts \
  test/harness-eval-production.test.ts \
  test/merge-gate-paths.test.ts
pnpm --filter @xiechimon/cairn exec vitest run test/merge-gate-readiness.test.ts -t harness-regression
node scripts/pr-gate-selfcheck.mjs
pnpm typecheck && pnpm lint && pnpm spec:parse
```

## Artifacts

| File | Role |
| --- | --- |
| `paths-red.log` | ⑦ path tests against main tip (coordinator/production unprotected) |
| `paths-green.log` | ⑦ path tests after protect glob |
| `pr-gate-selfcheck-red.log` | selfcheck red before protect glob |
| `pr-gate-selfcheck.log` | 95/95 after SCRIPT_SHA256 refresh |
| `harness-eval-lifecycle.log` | 119/119 coordinator + production + routing + paths |
| `readiness-threshold.log` | harness-regression readiness cases; threshold path untouched |
| `lint.log` / `typecheck.log` / `spec-parse.log` / `english-only.log` | gates |

## Rule

Do not weaken `CHIEF_DISPATCH_BASELINE_DECISION_OK_CI_LOWER` (0.924). Missing and
stale stay human when no live attempt remains; only evaluating is transient.

# Commit-confirmation verification

Additional coordinator-authorized repair for PR #3643, #3696 and PRRT_kwDOUSKs6c61U0n6. Bug class: transaction/publication atomicity. Transcript effects from steering and both restart branches are published only after their enclosing Drizzle transaction returns successfully. Queue identity and rollover forwarding are unchanged.

## Red-first regression and sweep

The initial 12-case server suite failed 10 cases on the reviewed head: steer, thread route, idle continuation, manual/automatic/stop queue delivery, rollover, both restart branches, and publication-before-ledger/queue completion. Coordinator submission and queue creation already used post-transaction publication and passed their rollback cases. The repaired 15-case suite also checks a final-ledger abort, autocommit revisions, and SQLite's actual `inTransaction` flag at the publication boundary. Successful retries emit one confirmation and consume the intended capsule only.

The producer sweep is in `../commit-confirmation-design.md`. The shared helper accepts the existing deferred-effect-list pattern; both transactional callers flush after commit, discard effects on rollback, and skip effects on submission replay. Autocommit revision rows, Coordinator route acknowledgements, task queue creation and non-user invalidations retain their existing behavior. No database migration, SSE schema, dependency or provider protocol changes.

## Live failure injection

`probe.mjs` runs against an isolated real server and browser. A SQLite trigger fails `steer_pending` insertion after the user transcript insert. Browser reconciliation GETs are held for 5000 ms. `result.json` records two paths:

| Path | Rejected response | Persisted user rows / delivered SSE / false bubbles | Preserved | Retry response | Visible after retry |
| --- | --- | --- | --- | --- | --- |
| Thread composer | 500 | 0 / 0 / 0 | Exact draft and submission key | 201 | 81 ms, one bubble |
| Queued Send now | 500 | 0 / 0 / 0 | Source capsule | 201 | 97 ms, one bubble, no stale capsule |

Neither path released a held GET before the assertions. Authoritative REST and SQLite agree with the browser. The seeded claimed step is synthetic; no daemon or model executes. Failure and retry screenshots were inspected and remain in the scratch evidence directory. `rollover-result.json` repeats automatic local-merge rollover with the repaired post-commit publisher: 268 ms, one bubble, zero stale capsules, source frame observed before the target subscription, and no held GET released. Desktop light/dark and a true 390 px phone were checked by that rollover driver; zero phone overflow.

Reproduce from the repository root with ports 18868 and 18869 free:

```sh
mkdir -p "$HOME/.cache/codex-scratch/pi-168"
cp docs/verify/3570/commit-confirmation/probe.mjs "$HOME/.cache/codex-scratch/pi-168/atomicity-probe.mjs"
node docs/verify/3570/commit-confirmation/verify-runner.mjs
```

The ownership-aware verify launcher supervises the stack; the runner cleans it up. Runtime state and screenshots land under `$HOME/.cache/codex-scratch/pi-168/atomicity-{stack,evidence}`. No credentials are archived.

## Checks and limits

306 focused server/web/shared tests and 21 affected browser tests pass. The related changed-test selection also passes. Full CI remains authoritative. The focused run reported worker-termination warnings for two web test files but exited successfully with every assertion passing. This verifies rollback suppression and successful retries at the exercised boundaries, not durable stream replay, arbitrary network reordering or real-provider behavior.

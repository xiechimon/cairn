# #1977 harness eval attempt coordinator

Durable attempt store and coordinator for regression evaluation dispatch. No readiness or automatic routing changes.

## Failure modes covered

- Concurrent claims for the same repo/pr/digest
- Repeated polling after a claim
- Process restart with the same database
- Dispatch port throw after a possible send (dispatch-uncertain, no second dispatch, escalate at deadline)
- Worker failure, rejected publication, unavailable worker, budget refusal
- Deadline expiry with no completion
- Late completion from a timed-out or wrong worker id
- New patch digest vs evidence-only same digest

## Evidence

- `tests-red.log`: vitest fails before implementation because `harness-eval-coordinator` is missing
- `tests-green.log`: 9 lifecycle tests pass
- `merge-gate.log`: existing merge-gate suite still passes (readiness untouched)
- `schema.log`: schema/migration registry tests pass with `harness_eval_attempts`
- `typecheck.log`, `lint.log`, `spec-parse.log`: acceptance gates

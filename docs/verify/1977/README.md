# Durable evaluation coordination

The explicitly invoked coordinator lives at
`apps/server/src/services/harness-eval-coordinator.ts`. The former script path
re-exports it for existing consumers. Readiness, automatic dispatch, scoring,
and routing remain unchanged. The required open and last-30-merged PR inventories
were checked on 2026-10-28. No open PR touches the changed paths. Recently merged
#2077 supplies the worker; its implementation remains untouched. The schema and vocabulary count assertions from #1727 change from 41 to 43 because this issue
adds two tables. Its migration rewind also removes the newer coordinator tables
and journal entries before replaying the preserved push-subscription checks.
All worker and push-subscription behavior remains unchanged. The pre-existing lockfile change is untouched.

## Invocation contract

Initialize the persistent server database through `openDbWithHandle` before
constructing `EvaluationCoordinator`. Migration `0066_harness_eval_attempts`
creates `harness_eval_attempts` and `harness_eval_current`, declared in
`apps/server/src/db/schema.ts`. The coordinator does not run migrations during
concurrent construction. All callers must use the same absolute database path
on a local filesystem. Legacy experimental `evaluation_attempts` databases are
not server databases and are not imported automatically.

Construct with `database`, positive integer `timeoutMs`, a trusted `worker`, and
optional `now` clock. Call:

```ts
await coordinator.request({ repo, pr, ticket, expectedHead, patchDigest });
await coordinator.reconcile(workerId);
await coordinator.complete(attemptId, workerId, { state: 'complete', result });
await coordinator.reconcileAll();
```

Repository names are normalized to lowercase. PR and ticket are positive
integers; head is a full lowercase SHA and digest is canonical `pd2:`.
`request` does not recompute digests. Uniqueness covers repository, PR, and digest,
including terminal attempts. Evidence-only head changes retain the worker identity
and deadline. New digests supersede live predecessors. `complete` validates both
attempt and worker identity before checking current authorization.

## Durable dispatch

A transaction persists identity, deadline, and `uncertain` state before dispatch.
Only the request that creates the row may invoke `worker.dispatch(attempt)`.
Every later request, including after process death before invocation, returns the
existing attempt without dispatching. This deliberately favors avoiding duplicate
paid runs over retrying a dispatch that might never have started.

`dispatch` returns `{ state: 'accepted' }` or an explicit terminal refusal.
Thrown or unrecognized acknowledgments leave dispatch uncertain. `poll(attempt)`
only looks up the persisted identity; it never launches work. It returns running,
unknown, terminal failure, or `{ state: 'complete', result }`. Startup and periodic
callers must run `reconcileAll`; no automatic readiness hook or timer is installed.
A stopped deployment resumes reconciliation on restart.

## Publication boundary

JavaScript publication callbacks are rejected before invocation, including ordinary
functions returning Promises. Instead, `worker.publication` contains an absolute
`command`, string `args`, and positive `timeoutMs`. The coordinator synchronously
executes that command with JSON `{ attempt, result }` on stdin. Success requires
JSON `{ commit: '<full SHA>' }` on stdout after command exit. Execution is bounded
by the smaller of the configured command timeout and remaining attempt deadline.
Timeout kills the command with SIGKILL and records publication rejection.

The coordinator holds a SQLite write transaction over command execution, so
concurrent supersession cannot revoke authorization while publication is running.
The trusted command must perform the worker's result validation, expected-head
checks, and result-only diff checks. It must not detach publication processes or
hand publishing credentials to evaluators. The existing monolithic #2077 CLI is
not a dispatch adapter: #1979 still needs to separate evaluation from the bounded
publication command. This change starts neither paid evaluations nor GitHub writes.

## Terminal outcomes

Worker failure, unavailable worker, budget refusal, deadline expiry, publication
rejection, and uncertain publication after process death require human attention.
Superseded workers and timed-out workers cannot enter the publication boundary.
Completion and all failures remain persisted; later callbacks do not republish.
Consumers must route `requiresHuman` outcomes through the existing decision
mechanism when #1979 installs automatic reconciliation.

## Verification

`review-red.log` shows the old implementation failing the new pre-dispatch crash,
Promise callback, and missing completion interface cases. `review-green.log`
records 26 passing lifecycle cases. Independent processes contend against the
migrated SQLite database. Crash tests exit after claim commit before dispatch,
after dispatch before acknowledgment, and after durable publication intent.
Restarted requests and evidence-only requests assert launch counts explicitly.
The suite also covers deadline expiry, direct completion identity checks,
supersession, late callbacks, terminal failures, and bounded publication.

The named server acceptance command runs the same process lifecycle suite:

```sh
pnpm --filter @xiechimon/cairn exec vitest run test/harness-eval-coordinator.test.ts
```

Validation logs use the `review-` prefix. Heavy checks run serially under
`/tmp/cairn-heavy.lock`. No manually managed dev, preview, or E2E server is started. The prepush Vitest
wrapper owns the integration fixture servers and their cleanup. This sandbox
requires leaving staging and committing to the external runner; `COMMIT_MSG.txt`
contains the complete message ending with `Closes #1977`.

The initial prepush run caught the missing shared table registration and the
migration rewind fixture (`review-prepush-vitest-red.log`). The expanded run
also caught the storage snapshot and shared count assertion, now extended for
exactly the two new tables (`review-shared.log`). No existing snapshot entries
or wire record schemas change. The focused server acceptance run passes all six
Vitest cases, including the subprocess lifecycle suite.

Final validation: `review-prepush-vitest.log` records 374 passing files and 4962
passing tests, including the named server coordinator acceptance. The standalone
lifecycle suite passes all 26 cases. Full typecheck, lint, spec parsing, the
feature-map gate, and E2E affected coverage pass. English, comment, and single-use
helper gates each report zero. Four lesson entries record the crash-window,
publication-yield, concurrent-migration, and schema-registration safeguards.
All heavy verification processes completed and integration fixtures cleaned up.
No push or local commit was attempted.

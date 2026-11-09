# PR review test fixture cost (#3582)

## 1. Scope

Repair the test-only performance regression that paused autonomous merging in
[#3582](https://github.com/xiechimon/cairn/issues/3582). Implementation tracking:
[#3587](https://github.com/xiechimon/cairn/issues/3587). This is a pure bug fix;
prior-art research is skipped. Production reconciliation, persistence, wire
contracts, timeouts, and retries remain unchanged.

## 2. Failure and measurements

[Main run 42582469873, attempt 1](https://github.com/xiechimon/cairn/actions/runs/42582469873/attempts/1)
on `bd34577fd0b60d7eabbffc093d66c2f75b815537` reported 5388 ms against the
5000 ms default timeout for the transition matrix; 3866 other tests passed.

A local probe froze Date, setTimeout, and setInterval without advancing them.
All 18 combinations completed in 1308 ms with zero pending timers; fixture
construction consumed 1232 ms (94%), cleanup 9 ms. There is no polling sleep.
Each fixture calls bootServer, which runs the full in-memory database migration
chain, seeds it, creates an app and keys, and allocates temporary directories.
Repeating that work 18 times in one test consumes a shared wall-clock budget
and becomes flaky under CI contention. Fake timers alone cannot remove it.

## 3. Failure cases and red controls

| Failure | Negative control on main implementation | Result |
| --- | --- | --- |
| Full boot for every transition/failure combination | Assert one bootServer call for the transition matrix | Red: 18 calls, 1278 ms locally |
| Full boot inside each label-wake failure loop | Assert one bootServer call per wake test | Red: 3 calls in both label tests, 254 / 215 ms |
| A future poll starts waiting on elapsed time | Run the matrix with fake timers, no advancement; assert unchanged Date and zero timers | All polls complete without clock advancement |

## 4. Single path and isolation

The transition matrix boots once and resets its stateful GitHub fake with a
fresh structured clone before each combination. It clears the query transcript
and retains every poll-count, convergence, and failure-consumption assertion.
Reconciliation with auto-fix enabled reads the local database but does not
write it. Assert empty step and message tables after every combination to catch
cross-case contamination. Cleanup uses the existing afterEach path; the manual
per-iteration disposal path is deleted.

Wake tests write durable state. Use the repository's existing test.each pattern
for their operation/failure Cartesian product, giving every case its own boot,
database and cleanup. Keep a one-boot assertion in each case. Fake-timer cleanup
uses afterEach so failed assertions also restore real timers.

## 5. Sibling audit

Inspect every for/while loop and fixture constructor in these five sibling files:

| File | Result |
| --- | --- |
| pr-review-findings.test.ts | Two loop sites boot repeatedly: transition and label-wake matrices; both repaired |
| pr-wakes.test.ts | Loops add rows or poll an existing fixture; scheduler tests already use fake timers |
| pr-reconcile.test.ts | Loops poll or populate one fixture; no loop boots a server |
| pr-merge-api.test.ts | Loops add rows or inspect existing worlds; no loop boots a server |
| pr-seg3.test.ts | Loops populate one fixture; no loop boots a server |

The siblings include short concurrency/ordering delays (5 and 20 ms), but these
are not repeated server initialization and do not explain this regression.
No production helper or database initialization contract changes are needed.

## 6. Delivery and acceptance

Link this design and the actual PR number in the PR body's section 6. Record
head-bound CI and cloud review there. Do not close #3582 manually: the closing
commit intentionally resumes autonomous merging through the existing issue hook.

The focused green run measured 205 ms for the transition matrix (one boot) and
78–91 ms for each of the six isolated label-wake combinations. Run all five
sibling files with --maxWorkers=4, then lint, typecheck, spec:parse, and prepush.
The existing poller runtime witness exercises the real app API and database
with fake GitHub; it must still expose wakeRounds=1 over GET /api/prs?threadId=t.
There is no changed UI or production behavior. Reverting the test-only change
restores the previous fixture strategy.

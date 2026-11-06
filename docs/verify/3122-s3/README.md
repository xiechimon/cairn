# D109 S3: thread PR wakes

Requirement: [D109, segment S3](../../research/thread-pr-autofix.md), refs #3122.

## Failure modes and test contract

The failure tests were written before the implementation in `apps/server/test/pr-wakes.test.ts`.

| Failure | Exercise | Required outcome |
| --- | --- | --- |
| F2: unbounded fixes | Rerun failed check runs, change heads, add review rounds, recreate the poller | At most 3 CI wakes per head, 2 conflict rounds, 3 review rounds, 10 total wakes; total cap disables Auto-fix |
| F2: repeated failure | Identical failure text on consecutive heads | Stop CI fixes early and request human intervention |
| F2: restart resets budget | Copy SQLite to a file, close it, reopen it, repeat the event and add another run | Duplicate produces no wake; next event continues the persisted count |
| F3: base is not green | Same-named base check fails, is cancelled, is missing, or cannot be read | No CI fix; later base success permits the deferred event |
| F4: own activity loops | Team login/app comments and a checkpoint push | No push-only or self-comment wake; a later failed check on that head still wakes |
| F5: simultaneous events | Dirty PR, failed CI and two comments in one poll | One session wake containing conflict, CI, then comments |
| F5: active session | Claimed, pending and concurrent pollers | One steer or appended pending prompt; no second step or duplicate budget debit |
| Ownership changes | Archive or disable Auto-fix during the read | No dispatch |
| Legacy repair bypass | Poll a managed PR with Auto-fix disabled using the old pollers | No old build step |
| Agent removal | No assignment; session routing rule present | Session wake resolves through the session rule |

## Runtime evidence

Run the real in-process server, PrWatch job and SQLite database with a stateful fake GitHub:

```sh
CAIRN_PR_WAKE_EVIDENCE=/tmp/d109-s3-runtime.json cairn-heavy pnpm exec vitest run apps/server/test/pr-wakes.test.ts
```

The runtime witness records an actual `GET /api/prs` request/response, the step and PR rows before and after the job, and the fake GitHub requests. The separate restart test closes and reopens a file-backed SQLite database.

The persistent ledger uses a namespaced system `message` row whose conversation id is the ledger id, as the existing feedback cursor does. Its key contains team, repository and PR number. A transaction commits event fingerprints, per-head/per-kind budgets, `thread_pr.wakeRounds`, and the session delivery together. A stale ledger snapshot or changed owner defers delivery. A new PR number gets a separate budget.

Scheduler CI and persisted feedback deadlines share one PrWatch promise per polling interval. The CI poller still reconciles lifecycle state, but its scheduler instance cannot issue fixes. The legacy feedback service remains available to existing callers and yields to a `thread_pr` owner.

No UI, schema migration, dependency or lockfile changes are included. Bot allowlists, review replies, merge actions, archiving and the dedicated stuck-PR projection remain in S4–S6. Production GitHub and an LLM executing the repair are not covered by this offline verification.

## Local results

| Check | Result |
| --- | --- |
| New fake-GitHub wake tests | 33 passed |
| Related existing regression tests (`--changed`, 30s timeout) | 147 passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed in every workspace |
| `pnpm spec:parse` | Passed: 205 web spec files and 70 integration files |
| `pnpm --filter @cairn/web e2e:affected` | 30 passed across 5 selected specs |

The first regression run hit two existing tests' 5s timeout. The repeat used a 30s timeout and passed all 147 tests. The 33 new tests passed with the default timeout. The `--changed` selector does not select the new untracked test file, so it was also run explicitly.

`calls.txt` is the actual in-process Hono request/response and the job's SQLite row counts, exported from the passing runtime witness. Screenshots show this transcript in Chromium's plain-text viewer and the unchanged original design source; they do not represent a production GitHub or LLM run.

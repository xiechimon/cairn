# Review round two: partial fix, acceptance blocked

This note supersedes the historical-replay and acceptance claims in
`replay-and-red-evidence.md`. That earlier note is not valid historical evidence.

## Finding 1: closure safety

`apps/server/src/services/scheduling/plan.ts:169` allowed superseding text,
handover comments and ledger mentions to bypass incomplete acceptance checkboxes.
It also accepted a PR title alone as delivery evidence.

Before changing implementation, ran:

```
pnpm --dir apps/server exec vitest run test/scheduling-plan.test.ts -t 'review round two closure safety'
```

Result: 6 failed, 1 passed, 24 skipped. See `round2-finding1-red.txt`.

Closure now requires at least one checked acceptance item, no unchecked items,
and an issue reference in a merged PR body. Superseding text can classify a
closure only after that guard passes. Ledger and handover mentions cannot
bypass it. The collector fetches merged PR bodies through the existing read seam.

Before changing the collector, ran:

```
pnpm --dir apps/server exec vitest run test/scheduling-plan.test.ts -t 'collector retains'
```

Result: 1 failed, 31 skipped: the collected pull lacked its body.
See `round2-collector-red.txt`.

After the fix, both regression sets pass together: 8 passed, 24 skipped.
The complete planning test file passes: 32 passed. The final planning and sweep
files pass together: 37 passed (`round2-targeted-green.txt`). See
`round2-finding1-green.txt` and `round2-plan-green.txt`.

## Finding 6: unresolved historical evidence and chief registry coverage

The supplied fixture contains 31 issues, not 45. Its main SHA is forty zeroes.
It includes subsequent closure comments. Reading a fixture with today's API
cannot establish its issue bodies, labels and comments at the historical cutoff.
No historical report JSON is supplied or claimed here.

A pre-fix validation command failed with:

```
Invalid historical replay: issues=31, mainSha=0000000000000000000000000000000000000000
```

See `round2-finding6-red.txt`. This finding has no green result.

The linked manual report was read through Jina on 2026-10-27. It returned
"Sign in to view this page" rather than the report. The fixture's #1394 and
#1403 bodies contain unchecked acceptance items. Requiring those issues in the
close group conflicts with the review's mandatory completed-checkbox guard.
The actual chief registry test remains outstanding. Shared tool lists are not
claimed as runtime chief coverage.

Required owner decision: should the historical replay preserve the strict
completed-checkbox guard and expect these issues to require human judgment,
or use an explicitly specified evidence rule for superseded/transferred work?
An authentic 45-issue snapshot and its main SHA are also required to establish
the historical acceptance result. No missing issue, checkbox or timestamp has
been invented to make the replay pass.

## Worktree state

The worktree already had an interrupted rebase onto `bae182d9` when this round
started. `apps/server/drizzle/meta/0061_snapshot.json` and `_journal.json` remain
unmerged. They overlap merged PR #2026's first-PR migration. Neither that
migration nor its metadata was deleted. Git metadata is read-only for this task;
no rebase continuation, staging, commit or push was attempted.

## Verification results

- `pnpm lint`: passed.
- `english-only-gate`, `single-use-helper-gate`, `comment-discipline-gate`: zero.
- `lessons-ledger-gate`: passed.
- Final targeted planning and sweep tests: 37 passed.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: failed,
  4833 passed and 3 failed. Two failures are the disputed historical closures.
  The third was the sweep's old ledger-only fixture, subsequently updated to
  completed acceptance and merged PR body evidence; its final targeted run passes.
  See `round2-vitest-result.txt` and `round2-targeted-green.txt`.
- A full green suite and historical replay are not claimed.
- Typecheck and `spec:parse` were queued through `flock`, then cancelled while
  still waiting for the shared lock after the blocking acceptance decision was
  confirmed. Neither has a result for this round. `e2e:affected` was not run.
- No server was started manually. The completed Vitest run finished its managed
  integration fixtures; both pending verification commands were cancelled.

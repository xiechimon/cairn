# PR #1879 CI diagnosis

## Cause

The failing check tested ae87b15652f0ea0751ddb2e423677a478d34b393.
The failure is inherited from main, not introduced by the memory-regression changes.
The roster implementation, snapshot, regression test, and lockfile are identical
between that failed head and origin/main at 0117480ad956c1b0bc6b1f5cef149fdd11a9802f.
The installed pi-ai package is 1.4.0, matching the lockfile.

The worktree already contained commit 0f90f5df28b76ccba36f80befcade84d5813e992,
which synchronizes the snapshot with those catalogs. No additional code change
was made during this diagnosis. ADR 0027 requires this catalog equality check.

## Local reproduction

All test and verification commands ran through `flock /tmp/cairn-heavy.lock`.

Command: `pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts`.

With the origin/main snapshot temporarily substituted, the existing test failed:

```text
FAIL test/merge-gate-model-roster.test.ts > merge-gate model roster > the checked-in snapshot matches the installed pi model catalogs
AssertionError: expected { vendors: { …(162) }, …(1) } to deeply equal { vendors: { …(157) }, …(1) }
Test Files  1 failed (1)
Tests  1 failed | 1 passed (2)
```

After restoring the snapshot from local HEAD, the same test passed:

```text
Test Files  1 passed (1)
Tests  2 passed (2)
```

The focused test also passed independently before the negative control.
The original snapshot was restored before releasing the lock.

## Verification

- `pnpm lint`: passed, with two informational diagnostics in unrelated files.
- `pnpm typecheck`: passed for all workspace packages.
- `pnpm spec:parse`: passed; 1299 web tests in 184 files collected and 37 integration test files parsed.
- `git diff --check`: passed.
- GitHub `pr-evidence`: passed on the failed PR head; no PR body change is needed.
- Remote main was verified through the GitHub API as 0117480ad956c1b0bc6b1f5cef149fdd11a9802f.
- That main commit is already an ancestor of lane/1773; rebasing would be a no-op.
- `docs/lessons.md` was left intact, preserving all rows.

No Git metadata was written and nothing was pushed. The full commit message is
provided in `COMMIT_MSG.txt` for the sandbox handoff.

## Second round (2026-10-28): pr-evidence, e2e (2), e2e-gate

Run 40614206275 (head 5bd1e3fc, `pull_request`) failed three checks:
`pr-evidence`, `e2e (2)` and `e2e-gate`.

### pr-evidence: the needs-decision label, not the body

The PR carries the `needs-decision` label. `.github/workflows/pr-evidence.yml`
reds on that label by design (the decision guard added after #1435): a person
has to remove it before the PR can merge. All other steps in the job are
skipped when the label step fails, so the failing step is the label guard, not
the body.

The body itself passes every local gate against the live API state:

```text
pr-evidence: sections: 2/2 answered
pr-evidence: scanned 0 image link(s)
pr-evidence: GREEN
pr-tasks: GREEN
english-only-gate: 0 line(s) with Chinese text
```

No PR body change is needed; the fix is removing the label.

### e2e (2) and e2e-gate: a pre-existing flaky assertion in composer-slash

Shard 2 failed one test: `composer-slash.spec.ts:224:1 > Tab completes without
running; Enter without highlight sends (F1)`, at line 236
`expect(sent).toHaveLength(1)` received `[]`. `e2e-gate` aggregates the shard
results and reds as a consequence.

Evidence that this is a flake, not a branch regression:

- The CI job checked out `refs/remotes/pull/1879/merge`, which is head
  `5bd1e3fc` merged into `68614c66` - the branch's own direct parent, so the
  tested tree equals the branch head exactly. Main's two newer commits
  (204491eb, 10dc817b) were not part of the tested tree.
- The branch diff (10 files: hillclimb state, memory-regression cases and
  grade, verify docs, one harness seed doc, one merge-gate path entry)
  touches no `apps/web` file, and the spec has been untouched since it was
  created (#804); only a comment cleanup (#1721) touched it since.
- Locally under `flock /tmp/cairn-heavy.lock` the full web suite passes
  (1367 tests), the composer-slash file passes (10 tests), and the exact
  failing test passes on three consecutive single runs.
- The assertion is one-shot on a plain array: Playwright's `toHaveLength`
  does not retry a non-locator value (verified with a probe that appended to
  the array 1.5s after the assertion and still failed). The `sent` array is
  filled by a `page.route` handler when the POST reaches the browser; the
  assertion runs immediately after `press('Enter')`, racing the async
  roundtrip. Line 236 is the only `toHaveLength(1)` in the composer specs;
  every other assertion checks `toHaveLength(0)`, which cannot race.

On a loaded CI runner the send roundtrip outran the assertion once; on the
local machine it never does. The test is racy by construction and predates
this branch.

### Rebase and gates

- `git rebase origin/main` replayed the branch commit onto 10dc817b; the
  branch and main changed disjoint file sets, so the rebase was clean and
  every `docs/lessons/` row survived (README identical to main).
- `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` all pass on the rebased
  tree; the branch's memory-regression unit tests pass (208 tests in 2
  files).
- The commit message keeps a single `Closes #1773` line.

Nothing was pushed.

## Third round (2026-10-28): pr-evidence on head 93368586

Run 40620421891 (head 93368586, the current head) failed only `pr-evidence`.
The cause is unchanged from the second round: the PR carries the
`needs-decision` label, added by the orchestrator at 2026-10-27T23:42:57Z, and
`.github/workflows/pr-evidence.yml` reds on that label by design. The body
gates all pass locally against the live API state:

```text
pr-evidence: sections: 2/2 answered
pr-evidence: scanned 0 image link(s)
pr-evidence: GREEN
pr-tasks: GREEN
english-only-gate: 0 line(s) with Chinese text
```

`e2e (1)` to `e2e (4)` and `e2e-gate` all pass on this head (run
40620421669), so the second round's composer-slash flake did not recur. The
branch is rebased on the current origin/main head (parent cbfbd566, 0
behind); the commit message keeps a single `Closes #1773` line; every
`docs/lessons/` row survived. No code change was made: pr-evidence is red on
the decision guard, and a person has to remove the `needs-decision` label
before this PR can merge. The review gate's BLOCK on case `a05` (blocking)
and the per-model baseline evidence (suggestion) stand: `cases.json` and
`metrics.md` are byte-identical between the last reviewed head 6fd98510 and
this head.

Nothing was pushed.

## Fourth round (2026-10-28): pr-evidence on head 28469ebb

Run 40627417096 (head 28469ebb, the current head) failed only `pr-evidence`;
all other checks on the run passed (`check`, `commit-author`,
`diagram-text-fit`, `e2e (1)` to `e2e (4)`, `pack-smoke`,
`dead-class-gate`, `issue-label-gate`, `feature-map-gate`,
`comment-discipline-gate`, `probe-reach-gate`, `single-use-helper-gate`,
`npm-command-gate`, `dispatch-agent-test`, `closing-keyword-gate`,
`baseline-ratchet-gate`, `e2e-gate`).

The cause is unchanged from the second and third rounds: the PR carries the
`needs-decision` label (added by the orchestrator at 2026-10-27T23:42:57Z),
and `.github/workflows/pr-evidence.yml` reds on that label by design. The
body gates all pass locally against the live API state:

```text
pr-evidence: sections: 2/2 answered
pr-evidence: scanned 0 image link(s)
pr-evidence: GREEN
pr-tasks: GREEN
english-only-gate: 0 line(s) with Chinese text
```

Since the third round, origin/main advanced by one commit
(`05d0dd12` fix(prepush) #1703), which touches only `docs/lessons/`,
`docs/spec/19`, `docs/verify/1703/`, `scripts/heavy-slots.test.mjs` and
`scripts/prepush-vitest.mjs` - a disjoint set from this branch's ten files,
so the rebase is clean and every `docs/lessons/` row survives. The commit
message keeps a single `Closes #1773` line. No code change was made:
pr-evidence is red on the decision guard, and a person has to remove the
`needs-decision` label before this PR can merge.

Nothing was pushed.

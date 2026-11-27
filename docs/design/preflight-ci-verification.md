# Pre-flight CI verification

Problem: every lane runs `pnpm prepush` and `pnpm test:changed` on its own
host before pushing, so on a shared Mac every landing is bought with tens of minutes of 8-core load per lane. The same checks already
run on GitHub runners for free (the repo is public); local verification should
become the fast, optional preview, not the gate.

## Model

A lane verifies on GitHub before it enters the landing queue:

- `refs/heads/preflight/<lane>` is a scratch ref per lane
  (`<lane>` = `localLane(worktreeRoot)`, the same name stamped into `Lane:`
  trailers: a random per-machine id kept in
  `~/.config/cairn-dev/lane-machine-id`, then the worktree name; it carries no
  host name). `node scripts/ops/preflight.mjs` stamps any unowned commits in
  `origin/main..HEAD` with `Lane: <lane>` first, then pushes that `HEAD` SHA
  there with `--force-with-lease` and, with `--wait`, follows the `ci` run to a
  conclusion. It pushes the SHA it handed to the fast gate and no tags, and its
  exit 0 covers the current `HEAD`: a `HEAD` found to have moved after the gate
  or after the wait for a CI slot pushes nothing, and one found to have moved
  when pre-flight is about to report success makes it exit 1. The lane runs it
  again.
- `ci.yml` triggers on `preflight/**` pushes and the `changes` job classifies
  them like queue pushes: base is `git merge-base origin/main HEAD` on every
  push, never `github.event.before` (which would make a second push to the
  same ref compare only the newest commits and could greenlight an untested
  diff).
- `queue/` is untouched during preflight: `speculative-queue.mjs` reads
  `refs/heads/enqueue/*` and builds `refs/heads/queue/try/*` only after a head
  is preflight-green — a `preflight/*` run can never be promoted or counted as a
  live queue candidate.
- `scripts/ops/preflight.mjs` runs `scripts/ops/preflight-fast-gate.mjs` on
  the exact committed `HEAD` tree before pushing `refs/heads/preflight/<lane>`
  (the secret scan, revert guard, CI's cheap checks, `pnpm lint`,
  touched-package `typecheck`, and `pnpm test:changed`), and refuses to push if
  it fails. The secret scan runs first, after the trailer stamping has fixed the
  SHAs: `scripts/ops/secret-scan.mjs` runs gitleaks, redacted, over the diffs
  and commit messages since `origin/main`, in a bare copy of the repository so
  local git configuration cannot hide text. It honours only committed
  `.gitleaksignore` entries that name a commit, and is red when gitleaks is
  missing (install with `node scripts/ops/install-gitleaks.mjs` for pinned
  SHA-256 verification, shared with CI, or `brew install gitleaks`), logs an
  error or has no merge-base. It runs where the gate runs, so that machine
  needs gitleaks; the `ci` run does not repeat the scan. The revert guard
  (`scripts/ops/revert-guard.mjs`) checks every path changed against
  `merge-base(origin/main, HEAD)` and refuses heads whose resulting file blob
  or absence matches a pre-change state from the last 50 first-parent
  `origin/main` commits unless declared by `git revert <sha>`
  (`This reverts commit <sha>`) or a `Revert-landed: <path> - <reason>` commit
  trailer (non-hollow multi-word reason, no wildcards); missing `origin/main`
  or unreadable history exits `2`. The cheap checks and
  their conditions are read from `.github/workflows/ci.yml` at that `HEAD`,
  with `pnpm prepush --ci` expanded to its own plan: a node script named
  `*-gate` or `*-ledger`, or run with `--check`, is run unless CI marks the step
  `continue-on-error` or the fast gate names why it skips it. This reading is
  best-effort and the `ci` run has the final word: it matches the text of each
  step, so some ways of writing a step are misread or missed without any
  message, and a local pass does not promise a green run. A step, command or
  condition it does notice it cannot classify, no merge-base with `origin/main`,
  or a check that cannot run is red. Inline shell is not reproduced. The fast
  gate also runs `regression-inversion-gate.mjs --mode static` on the commits
  since `origin/main`: a `fix` commit that changes product runtime files and
  adds or changes no counted test file (`*.test.ts`, `*.test.tsx` or
  `*.test.mts` under `apps/`, `packages/` or `integration/`, or
  `scripts/*.test.mjs`; a Playwright `*.spec.ts` or a deletion does not count)
  is red, no test is run, and CI still checks that the tests fail on the
  parent. `scripts/plan-gate.mjs` also runs in the cheap-checks step and
  `check-core`, refusing Tier 1 commits without a hash-verified `PASS` plan
  reviewed by an independent `Reviewer-Model` (!= `Author-Model`), missing
  `"this change"` proving test files, or commits without an added/modified
  runnable proving test (`docs/ops/plan-gate.md`), while
  `scripts/regression-inversion-gate.mjs` proves those tests fail against the
  parent product source. On a machine that refuses multi-file test runs
  (no `CI`, `CAIRN_MINI_TEST` or `CAIRN_LOCAL_HEAVY`), `pnpm test:changed`
  runs a single related file, and with two or more it lists them, runs none and
  leaves them to the `ci` run. Setting `CAIRN_PREFLIGHT_GATE_WRAPPER`
  (whitespace-split command prefix) combines that plan into a single
  `<wrapper...> sh -c "..."` call so hosts can offload the gate to a dedicated
  test runner without hardcoding host-specific paths in the repository.
- `scripts/ops/preflight.mjs` admits at most two active (`queued` or
  `in_progress`) preflight `ci` runs and serializes local pushes on each machine
  in strict FIFO order through `withPreflightAdmission` (`PREFLIGHT_PUSH_POOL`,
  `preflight-queue` in `scripts/heavy-slots.mjs`). Only the head-of-line
  waiter polls GitHub every 10s, and it holds the local admission lock across
  the `git push` and initial workflow-run appearance check (`readRun`, waiting
  for a new run ID beyond pre-push runs on the same SHA even if local `HEAD`
  moves after the push) so queued waiters cannot stampede past the two-run
  cap; local CPU saturation
  and `CAIRN_HEAVY_GATE_BYPASS` never block or skip this admission lock.
  `CAIRN_PREFLIGHT_CONCURRENCY_BYPASS=1` skips both the FIFO lock and the
  remote capacity wait (never the fast gate). If the GitHub run-count API is
  unreadable the script proceeds after the fast gate because capacity is an
  efficiency gate, while the safety evidence remains the required checks on the
  exact SHA.
- Still-active `ci` runs on this lane's own ref that test another SHA are being
  replaced: they do not count against that cap, and once the new head is pushed
  they are cancelled. Nothing is cancelled when the wait or the push fails.
  Other lanes' refs, completed runs, a run on the same SHA and a run whose SHA
  sits under `enqueue/*` or `queue/try/*` (its verdict is still wanted) are left
  alone. The queued SHAs are read again right before cancelling, after the
  runs are listed, so a head queued during the capacity wait is kept; if those
  refs cannot be listed, nothing is cancelled. A failed lookup or cancel never
  blocks the push.
- `scripts/ops/push-queue.mjs` refuses to land a head with no green
  pre-flight evidence; local `pnpm prepush` / `pnpm test:changed` stay
  recommended but are no longer the gate. It always enqueues `HEAD` into
  `refs/heads/enqueue/*` for parallel `scripts/ops/speculative-queue.mjs`
  promotion, so the merge train is the single landing path.

## Gate predicate

`push-queue.mjs` admits `HEAD` with `conclusion: success` or `skipped` for
`check`, `pack-smoke` and `e2e-gate` in either of two admission states:

1. **`exact-green`**: exact `HEAD` SHA holds the three required green checks.
2. **`rebase-only-green`**: a tested `preflight/<lane>` SHA `S` holds the three
   required green checks, and `isCleanRebaseOf({ cwd, baseRef: 'origin/main', testedSha: S, headSha: HEAD })`
   holds (`testedBase = merge-base(origin/main, S)` is an ancestor of
   `headBase = merge-base(origin/main, HEAD)`, zero merge commits exist in either
   range, the commit ranges are non-empty, and every commit matches in order on
   `git patch-id --verbatim`, subject, author name and author email). In this
   state, `push-queue.mjs` and `speculative-queue.mjs` admit `HEAD` into
   `enqueue/*` without re-running `preflight`, while `speculative-queue.mjs`
   withholds `exactVerified` so the candidate MUST build and pass `queue/try/*`
   CI on its rebased tree before promotion to `main`.
3. **`unverified`**: neither holds (including any conflict edit, subject edit,
   added/dropped commit, backward rebase, merge commit, red `S`, or unreachable
   GitHub API -> fail closed); `push-queue` refuses (or runs `preflight` under `--wait`).

To overlap CI wait with landing review, lanes may run
`node scripts/ops/preflight.mjs --stamp-only` first to freeze `Lane:` trailers on
`HEAD`, then run `node scripts/ops/preflight.mjs --wait` concurrently with
`review-head` on that exact SHA, fixing all findings in one batch.

## States and failure behaviour

- **No pre-flight run for `S`**: push refused with the `preflight.mjs`
  command to run. Nothing is enqueued. With `--wait`, `push-queue.mjs` pushes the
  pre-flight ref itself, and again each time `HEAD` becomes another SHA, even
  with the same tree.
- **Run still in progress**: without `--wait`, the same refusal.
- **Run red**: the failed jobs are the ones to fix. The lane fixes, re-pushes
  its preflight ref and waits again.
- **Green on `S`**: `S` is enqueued; the queue is described in
  `docs/design/tested-sha-landing.md`.
- **`gh` API unreachable**: the check-runs lookup fails and the push is
  refused with the API error; retry once connectivity is back. Failing closed
  is deliberate: the gate exists to prove the head was tested.
- **Repeated pushes to one preflight ref**: `--force-with-lease` moves the
  ref; classification still diffs against `origin/main`, so each run covers
  the full candidate diff rather than the delta since the last preflight
  push.
- **Docs-only heads**: classify reports `has-code=false`, the heavy jobs skip
  and the three contexts go green in about a minute.

## What it costs

Local verification stays available for fast iteration, but a lane that trusts
the runners skips ~10–20 minutes of host load per push. GitHub minutes are
free for this public repo; the marginal cost is one extra `ci` run per lane
attempt; an entry stacked behind another in the queue is tested once more on its
`queue/try/*` ref.

See `docs/design/tested-sha-landing.md` for the queue and promote mechanics
this gate sits in front of.

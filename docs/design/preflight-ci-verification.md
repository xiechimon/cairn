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
  `origin/main..HEAD` with `Lane: <lane>` first, then pushes `HEAD` there with
  `--force-with-lease` and, with `--wait`, follows the `ci` run to a conclusion.
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
  (CI's cheap checks, `pnpm lint`, touched-package `typecheck`, and
  `pnpm test:changed`), and refuses to push if it fails. The cheap checks and
  their conditions are read from `.github/workflows/ci.yml` at that `HEAD`,
  with `pnpm prepush --ci` expanded to its own plan: a node script named
  `*-gate` or `*-ledger`, or run with `--check`, is run unless CI marks the step
  `continue-on-error` or the fast gate names why it skips it. This reading is
  best-effort and the `ci` run has the final word: it matches the text of each
  step, so some ways of writing a step are misread or missed without any
  message, and a local pass does not promise a green run. A step, command or
  condition it does notice it cannot classify, no merge-base with `origin/main`,
  or a check that cannot run is red. Inline shell is not reproduced. On a
  machine that refuses multi-file test runs
  (no `CI`, `CAIRN_MINI_TEST` or `CAIRN_LOCAL_HEAVY`), `pnpm test:changed`
  runs a single related file, and with two or more it lists them, runs none and
  leaves them to the `ci` run. Setting `CAIRN_PREFLIGHT_GATE_WRAPPER`
  (whitespace-split command prefix) combines that plan into a single
  `<wrapper...> sh -c "..."` call so hosts can offload the gate to a dedicated
  test runner without hardcoding host-specific paths in the repository.
- `scripts/ops/preflight.mjs` admits at most two active (`queued` or
  `in_progress`) preflight `ci` runs. While two are active it waits before
  pushing; `CAIRN_PREFLIGHT_CONCURRENCY_BYPASS=1` skips only this efficiency
  wait, never the fast gate. If the GitHub run-count API is unreadable the
  script proceeds after the fast gate because capacity is an efficiency gate,
  while the safety evidence remains the required checks on the exact SHA.
- Still-active `ci` runs on this lane's own ref that test another SHA are being
  replaced: they do not count against that cap, and once the new head is pushed
  they are cancelled. Nothing is cancelled when the wait or the push fails.
  Other lanes' refs, completed runs, a run on the same SHA and a run whose SHA
  sits under `enqueue/*` or `queue/try/*` (its verdict is still wanted) are left
  alone; if those refs cannot be listed, nothing is cancelled. A failed lookup or
  cancel never blocks the push.
- `scripts/ops/push-queue.mjs` refuses to land a head with no green
  pre-flight evidence; local `pnpm prepush` / `pnpm test:changed` stay
  recommended but are no longer the gate. It always enqueues `HEAD` into
  `refs/heads/enqueue/*` for parallel `scripts/ops/speculative-queue.mjs`
  promotion, so the merge train is the single landing path.

## Gate predicate

`push-queue.mjs` admits `HEAD` only with `conclusion: success` or `skipped` for
`check`, `pack-smoke` and `e2e-gate` on its exact SHA. `preflight.mjs` stamps the
`Lane:` trailer before it pushes, so the SHA it tests is the SHA submitted. A
green run on another SHA with the same tree does not admit `HEAD`. The first
entry on current `main` lands without a second CI run.

## States and failure behaviour

- **No pre-flight run for `S`**: push refused with the `preflight.mjs`
  command to run. Nothing is enqueued. With `--wait`, `push-queue.mjs` pushes the
  pre-flight ref itself.
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

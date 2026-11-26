# Pre-flight CI verification

Problem: every lane runs `pnpm prepush` and `pnpm test:changed` on its own
host before pushing, so on a shared Mac the serial `queue/main` pipeline is
bought with tens of minutes of 8-core load per lane. The same checks already
run on GitHub runners for free (the repo is public); local verification should
become the fast, optional preview, not the gate.

## Model

A lane verifies on GitHub before it occupies `queue/main`:

- `refs/heads/preflight/<lane>` is a scratch ref per lane
  (`<lane>` = `laneName(host, worktree)`, the same name stamped into `Lane:`
  trailers). `node scripts/ops/preflight.mjs` stamps any unowned commits in
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
  (`pnpm lint`, touched-package `typecheck`, and `pnpm test:changed`), and
  refuses to push if it fails. On a machine that refuses multi-file test runs
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
- `scripts/ops/push-queue.mjs` refuses to land a head with no green
  pre-flight evidence; local `pnpm prepush` / `pnpm test:changed` stay
  recommended but are no longer the gate. It always enqueues `HEAD` into
  `refs/heads/enqueue/*` for parallel `scripts/ops/speculative-queue.mjs`
  promotion, so the merge train is the single landing path.

## Gate predicate

Because `preflight.mjs` stamps unowned commits before pushing `preflight/<lane>`,
`push-queue.mjs` finds nothing left to stamp: `S = HEAD` is the exact SHA that
already passed pre-flight, so the train can admit `S` without a second CI run
on a queue try branch when it is the first entry on current `main`. If a lane
still has an unowned commit at push time, `push-queue.mjs` runs the same
stamping step and requires the three contexts (`check`, `pack-smoke` and
`e2e-gate`) with `conclusion: success` on `S` (or on the pre-stamp SHA, which
shares `S`'s tree). A green run on a tree-identical SHA counts as pre-flight
evidence, while train admission requires the green checks on `S` itself.

## States and failure behaviour

- **No pre-flight run for `S`**: push refused with the `preflight.mjs`
  command to run. Nothing touches `queue/main`.
- **Run still in progress**: same refusal; wait for `preflight.mjs --wait`
  to exit green, or push again later.
- **Run red**: same refusal; the failed jobs are the ones to fix. The lane
  fixes, re-pushes its preflight ref and waits again.
- **Green on `S` (or on its identical tree)**: the queue check proceeds as
  before — the lane may still wait if another candidate holds `queue/main`.
- **`gh` API unreachable**: the check-runs lookup fails and the push is
  refused with the API error; retry once connectivity is back. Failing closed
  is deliberate: the gate exists to prove the head was tested.
- **Repeated pushes to one preflight ref**: `--force-with-lease` moves the
  ref; classification still diffs against `origin/main`, so each run covers
  the full candidate diff rather than the delta since the last preflight
  push.
- **Docs-only heads**: classify reports `has-code=false`, the heavy jobs skip
  and the three contexts go green in about a minute — the same cheap path a
  docs push already takes through the queue.

## What it costs

Local verification stays available for fast iteration, but a lane that trusts
the runners skips ~10–20 minutes of host load per push. GitHub minutes are
free for this public repo; the marginal cost is one extra `ci` run per lane
attempt, which is exactly the run the queue would have burned on a red
candidate — so total runner usage rises only when a lane verifies once and
lands on the first try.

See `docs/design/tested-sha-landing.md` for the queue and promote mechanics
this gate sits in front of.

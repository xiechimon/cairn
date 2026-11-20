# Pre-flight CI verification

Problem: every lane runs `pnpm prepush` and `pnpm test:changed` on its own
host before pushing, so on a shared Mac the serial `queue/main` pipeline is
bought with tens of minutes of 8-core load per lane. The same checks already
run on GitHub runners for free (the repo is public); local verification should
become the fast, optional preview, not the gate.

## Model

A lane verifies on GitHub before it occupies `queue/main`:

- `refs/heads/preflight/<lane>` is a scratch ref per lane
  (`<lane>` = `laneName(host, worktree)`, the same name the push script stamps
  into `Lane:` trailers). `node scripts/ops/preflight.mjs` pushes
  `HEAD` there with `--force-with-lease` and, with `--wait`, follows the `ci`
  run to a conclusion.
- `ci.yml` triggers on `preflight/**` pushes and the `changes` job classifies
  them like queue pushes: base is `git merge-base origin/main HEAD` on every
  push, never `github.event.before` (which would make a second push to the
  same ref compare only the newest commits and could greenlight an untested
  diff).
- `queue/` is untouched: `queue-guard` watches only `queue/main`, and
  `promote-queue.mjs` reads runs whose `head_branch` starts with `queue/` —
  a preflight run can never be promoted, deleted or counted as the live
  candidate.
- `scripts/ops/push-queue.mjs` refuses to push a head with no green
  pre-flight evidence; local `pnpm prepush` / `pnpm test:changed` stay
  recommended but are no longer the gate.

## Gate predicate

`push-queue.mjs` computes `S = HEAD` after owner-trailer stamping, then for
`S` (and the pre-stamp SHA, which shares `S`'s tree) requires the check runs
GitHub reports for that commit to contain all of `check`, `pack-smoke` and
`e2e-gate` with `conclusion: success` — the same three contexts the
`green-main` ruleset requires and `promote-queue.mjs` inspects. A green run on
a tree-identical SHA counts because trailer stamping rewrites commit metadata
without touching the tree; a green run on a different tree does not.

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

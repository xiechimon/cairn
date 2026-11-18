# Green-main landing: prior art and a tested-SHA promotion design

Why: on 2026-11-18 three broken commits landed on `main` within hours — an ESM
import cycle that crashed tests at module-eval (`335d7b4a0`), a drizzle snapshot
generated on a stale base that resurrected dropped tables (same commit), and a
surface retirement that left contract tests exercising removed APIs
(`9685c6975`). Each was eventually caught by a `ci` run that happened to finish;
the AGENTS.md "check CI before pushing" rule never saw a completed red.

## What actually happened (measured)

- `.github/workflows/ci.yml:9-11`: all main pushes share the `ci-main`
  concurrency group with `cancel-in-progress: false`. A *running* main run is
  never auto-cancelled — that is deliberate and pinned by
  `scripts/workflow-concurrency.test.mjs` ("never cancel a running main run").
- Per GitHub concurrency semantics, **a new run in the group still replaces the
  existing *pending* run** regardless of the flag. Every "cancelled" run seen on
  2026-11-18 was a pending run superseded before it started — the coalescing is
  "always test the tip", which is itself desirable.
- Net behavior today: mid-stream commits get no individual signal; the next
  completed run covers the cumulative tree, so reds cannot hide forever but
  surface late and get attributed to the newest commit instead of the culprit.
- `scripts/ops/deploy-watch.sh` already encodes "green": a completed+success
  `ci` run on the head SHA plus `check`, `pack-smoke`, `e2e-gate` check-runs
  green. That predicate is the only thing standing between a red main and a
  deploy, and it held — nothing broken shipped.

## Prior art

| Source | How it keeps main green | Trade-offs for cairn |
| --- | --- | --- |
| GitHub merge queue ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | Builds a `merge_group` of base + queued PRs, merges only when its required checks pass; failing PRs are ejected and groups rebuild | PR-scoped only — there is no enqueue-a-pushed-commit API. Adopting it = adopting PRs (verified: entry points are `gh pr merge`, merge box, `enqueuePullRequest`) |
| bors / rust-lang homu ([bors-ng](https://github.com/bors-ng/bors-ng), [rust forge rollups](https://forge.rust-lang.org/release/rollups.html), [Hoare "not rocket science"](https://graydon2.dreamwidth.org/1597.html)) | Bot merges approved work onto an `auto` branch, CI runs there, on green the bot fast-forwards main to the *already-tested* SHA; on failure main is untouched. Batches and bisects failures; `treeclosed` freezes landings | Exactly cairn's shape minus PRs: the tested-SHA promotion trick needs no PR — statuses attach to the commit, not the branch. Serialized landings are the accepted cost (rust CI ~3h; ours ~7min) |
| Zuul ([gating docs](https://zuul-ci.org/docs/zuul/latest/gating.html)) | Dependent pipeline + speculative execution: each change tested on "everything ahead merged"; failures ejected and dependents retested | Strongest guarantee ("tested exactly as merged"), heaviest infra. Its core insight transfers cheaply: at cairn's volume speculation degenerates to "test the candidate tip" |
| GitHub required status checks on pushes ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) | Required checks evaluate the head SHA of *any* update to a protected branch — including direct pushes. Push an untested SHA to main → rejected (`GH006`). Push the same SHA elsewhere first, let CI report on it, then promote → accepted | The pivotal finding: server-side enforcement exists without PRs and without pre-receive hooks (pre-receive is GHES-only). A small promoter bot is the only new infra |
| Kubernetes codegen verification ([verify-codegen.sh](https://github.com/kubernetes/kubernetes/blob/master/hack/verify-codegen.sh)) | Regenerate + `git diff --exit-code`, run as a *presubmit* inside their Tide merge bot — i.e. before the tested SHA is promoted | Identical pattern to cairn's `db:generate` drift gate, which was already correct; the hole was that no run completed, not the gate |
| dependency-cruiser / madge ([dependency-cruiser](https://github.com/sverweij/dependency-cruiser/), [GitLab MR !181522](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/181522)) | Static `no-circular` gate; GitLab moved cycle detection off ESLint after it missed 45 real cycles | An ESM cycle that crashes at module-eval is statically detectable and would fire in `pnpm prepush` — earlier and cheaper than "whichever test first imports the module" |

## Recommendation

Every mature system converges on one invariant: **test a candidate ref, then
promote the tested object to main — never integrate-then-test** (Hoare's "not
rocket science" rule). For a no-PR repo the degenerate version is:

1. **Tested-SHA promotion (the real fix).**
   - Ruleset on `main`: require `ci`/`check`/`pack-smoke`/`e2e-gate` on the head
     SHA, restrict pushes to the promoter bot (bypass list for humans), require
     linear history, block force pushes.
   - `ci.yml` `on.push.branches` gains `queue/**` (or `candidate/**`) — statuses
     report on the pushed SHA regardless of ref.
   - Lanes keep one command: `git push origin HEAD:queue/main`. A
     ~100-line promoter (`scripts/ops/promote-main.mjs`, reusing the `green()`
     predicate from `deploy-watch.sh`) polls the candidate SHA and on green runs
     `git push origin <sha>:main`. On red, the lane fixes the candidate and the
     cycle repeats — main never goes red, so "reds accumulate and untangle
     later" deletes itself.
   - Batching is free: the queue ref can accumulate several commits per run.
     Failure handling is the degenerate case of bors bisection — drop the tip
     or split.
   - Cost: landing latency ≥ one full ci run; the bot is new owned infra;
     every lane's push target changes (wrap it in a `scripts/` helper so the
     change is mechanical).

2. **Cheap meanwhile (no infra).**
   - AGENTS.md wording: the pre-push signal is *the last completed `ci` run on
     main covering your merge base* — pending/replaced runs are not a signal.
     A cancelled or never-started run means "unknown", not "green".
   - `pnpm prepush` gains a dependency-cruiser `no-circular: error` gate over
     `packages/shared` + `apps/*/src` — the import-cycle class becomes a
     compile-time failure instead of whichever test loads the module first.
   - Keep `cancel-in-progress: false` on main and do **not** set `queue: max`:
     the pending-replacement coalescing already implements "test the tip" for
     free.

Explicitly rejected: adopting PRs + GitHub merge queue (same guarantee, managed
service, automatic ejection — but inverts the no-PR workflow rule for zero
semantic gain over SHA promotion); `queue: max` (a serial backlog buys
per-commit attribution, not extra coverage — the tip run already covers the
cumulative tree).

Verified against the live repo: `main` has a branch-protection stub with
`required_status_checks: null`, `restrictions: null`, `enforce_admins: false`
and no rulesets at all — nothing exists to conflict with, and required checks
would be a genuinely new enforcement layer. Still open (inferred): that
`check`/`e2e-gate` aggregates satisfy "skipped/neutral = success" semantics on
a queue ref; they were built for exactly that (#762), but the path-filter
behavior on a non-main ref should be pinned before the ruleset goes on.

Sources were read against live docs on 2026-11-18; repo mechanics and
protection settings were read first-hand. Claims are marked verified (read or
run first-hand), inferred (derived from verified facts), or guessed
(everything else).

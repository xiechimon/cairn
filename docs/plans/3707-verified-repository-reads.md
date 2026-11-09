# Verified repository reads: legacy-cache recovery

Status: approved with the one-shot daemon trigger; implementation follows this verdict.

## Failure and scope

At 2026-11-09 18:08Z, after deployment of f76dd3334, a Coordinator docs request for `scripts/owned-process.mjs` failed with `commit is not reachable from the current repository verified refs`. Read-only inspection confirmed the stored result, a GitHub project with baseBranch null and an obsolete foreign-machine localPath, a usable cache/default branch, and the requested Git blob. The cache had zero refs under `refs/cairn/repositories/`.

#3494 publishes provenance during daemon workspace preparation, but a legacy cache can be read before another preparation. Ordinary Git fetches do not publish Cairn provenance. The guard correctly refuses unproven history; the stale localPath is not the selected source.

## Decision table

[Coordinator verdict](https://github.com/xiechimon/cairn/pull/3737#issuecomment-6747925045):

| Decision | Final recommendation | Coordinator verdict |
| --- | --- | --- |
| Recover matching legacy caches | Prepare missing current-identity provenance | Approved |
| Authority | Atomic/pruned fetch of the captured origin URL through the existing daemon Git backend; never copy legacy refs into trusted refs | Approved |
| Trigger | One-shot backfill of existing caches at daemon startup; normal workspace preparation remains the next retry path | Approved change: no lazy network fetch in readers |
| Reader while pending/failed | Visible actionable `repository cache not verified yet` refusal | Approved |
| Fallback | Stay out of this repair; it cannot fix the observed missing path | Agreed; #3707 remains open |

## States and transitions

| State | Transition or result |
| --- | --- |
| Non-cache or escaping/link path | Skip; never fetch another checkout |
| Current-identity verified refs exist | Skip startup fetch; existing guarded readers remain network-free |
| Existing cache without current-identity refs | Startup backfill captures its configured origin and runs one bounded fetch |
| Fetch succeeds | Atomically publish fetched heads/tags under the captured identity; preserve working tree, local branches and unpushed objects |
| Fetch fails or times out | Log an actionable failure; keep visible refusal; retry on daemon restart or the project's normal preparation |
| Origin changes during backfill | Fetch only the captured URL into its own namespace; defer success reporting; new identity remains unverified until its own fetch |
| Read during publication | Observe old or new atomic refs; never bypass proof or borrow a preparation result |

## Read/write inventory and regression contract

| Path | Required behavior and regression |
| --- | --- |
| Daemon startup | Scan only existing project caches; backfill once before normal processing, without claiming a repository task |
| docs / readFile, omitted ref | Reproduce stale foreign-machine localPath, baseBranch null, origin/HEAD -> main, blob present, zero provenance; refuse before backfill, then return exact committed bytes/full SHA |
| readTree / readFiles | Same network-free admission and commit proof; succeed after backfill |
| readCommitHistory / readCommitDetail | Same proof boundary; succeed after backfill |
| Explicit HEAD/tag/branch/SHA | Retained unrelated commits remain denied; preserve the existing six-reader retarget matrix |
| Failed fetch / later preparation | No partial authority; actionable refusal until a subsequent successful pass |
| Retarget during backfill | A's fetched history cannot authorize B; the next pass prepares B |
| Normal daemon preparation | Existing credential-aware atomic fetch continues publishing provenance and retries a failed startup preparation |
| Verified cache / raw fetch | Verified cache is not fetched again by the backfill; raw remote-tracking refs alone remain insufficient |
| Local-kind / hosted reads | Preserve existing behavior and tests |

## Boundary, credentials and rollout

Fetch execution stays behind `apps/daemon/src/backend/`, reusing the native Git primitive. Startup has no per-step credential; it uses the daemon's existing non-interactive machine Git credentials. Private repositories without usable machine credentials remain refused until normal credential-aware workspace preparation succeeds. No server-to-daemon call, credential store, task, manifest, protocol or background retry loop is added.

The fetch uses the captured URL directly rather than a mutable origin alias. Startup uses a 30-second per-cache deadline and does not retry internally. A failure for one cache does not authorize it or prevent other caches from being checked. Reader origin/path validation and immutable-commit reachability remain unchanged; only the missing-proof error becomes actionable. Missing default-branch metadata remains #3703, not this repair.

The live-shape success test, failed-fetch refusal and retarget test are red first. Run targeted Vitest with maxWorkers=4, lint, typecheck, spec:parse and prepush, followed by current-head CI/cloud review. Keep coordinator-hold. The owner repeats the original question after deployment; manual live ref seeding or a database path correction is not acceptance.

Primary references: [readers](../../apps/server/src/services/git.ts), [atomic fetch](../../apps/daemon/src/git.ts), [namespace](../../packages/shared/src/repo-cache.ts), [normal preparation](../../apps/daemon/src/workspace.ts), [regressions](../../apps/server/test/chief-docs.test.ts). This repairs the existing lifecycle rather than proposing another Git protocol or dependency.

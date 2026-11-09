# Verified repository reads: legacy-cache recovery

Status: proposed; coordinator review required before implementation.

## Failure and scope

At 2026-11-09 18:08Z, after deployment of f76dd3334, a Coordinator docs request for `scripts/owned-process.mjs` failed with `commit is not reachable from the current repository verified refs`. Read-only inspection confirmed the stored tool result, a GitHub-bound project with no configured base branch, an obsolete localPath from another machine, a usable project cache, a default remote branch, and the requested Git blob. The cache contained zero refs under `refs/cairn/repositories/`.

The reader correctly refused unproven history. The lifecycle defect is that #3494 publishes provenance during daemon workspace preparation, while a pre-existing cache can be read without another workspace preparation. Ordinary Git fetches do not publish Cairn provenance. A stale localPath is neither the selected source nor a recovery mechanism.

This proposal repairs direct reads of existing caches. It does not restore the GitHub localPath fallback, scan other checkouts, create tasks, borrow threads, change a working tree, or bless pre-existing remote-tracking refs. The fallback portion of #3707 stays open. Default-branch retargeting remains separately tracked in #3703.

## Decision table

| Decision | Recommendation | Coordinator verdict |
| --- | --- | --- |
| Recover a matching legacy cache | Prepare provenance lazily before its first direct read | Pending |
| Authority | Fresh fetch from the captured project URL through the existing daemon Git backend; never copy legacy refs into the trusted namespace | Pending |
| Fallback | Keep it out of this repair: the observed path does not exist on this host and cannot fix the incident | Pending |

## States and transitions

| State | Transition or result |
| --- | --- |
| No cache, invalid binding, escaping path, or mismatched origin | Existing visible refusal; no checkout discovery or fallback |
| Current-identity verified refs exist | Existing guarded commit resolution; no network refresh merely because an arbitrary requested SHA is denied |
| Matching cache with no current-identity verified refs | Join or start one bounded preparation for that real cache directory and captured repository identity |
| Preparation succeeds | Atomically publish current-origin heads/tags through the existing fetch primitive; revalidate binding and origin; resolve the immutable commit through provenance |
| Preparation fails, times out, or publishes no usable proof | Visible refusal; do not read unverified blobs or retain an in-flight entry |
| Binding or origin changes during preparation | Refuse that read; never label history fetched for A as B |
| Concurrent reads | Coalesce only the same cache and captured identity; other identities must not inherit a preparation result |

## Read/write inventory and regression contract

| Path | Required behavior and test |
| --- | --- |
| docs / readFile, omitted ref | Reproduce the live shape: stale foreign-machine localPath, baseBranch null, origin/HEAD pointing to main, blob present, zero provenance refs. First read returns exact committed bytes and full SHA after successful preparation |
| readTree / readFiles | Same admission and preparation; no unverified file metadata |
| readCommitHistory / readCommitDetail | Same admission and preparation; no unverified history or patches |
| Explicit HEAD, tag, branch, or SHA | Preparation is not authority for unrelated retained commits; retain the retarget-denial matrix |
| Normal daemon workspace preparation | Continue publishing the same namespace through the existing atomic/pruned fetch |
| Raw Git fetch or legacy cache | Does not establish authority by itself; the reader must prepare provenance or refuse |
| Local-kind and hosted readers | Preserve their existing behavior; no new refresh policy |
| Parallel reads, failure/retry, and retarget races | One preparation for a shared identity; failure is retryable; a changed binding cannot consume the old result |

## Implementation boundary and failure handling

Keep fetch execution behind `apps/daemon/src/backend/` and use the existing native Git primitive rather than another parser, Git client, manifest or wire protocol. The server admission bridge supplies an immutable canonical repository URL and the existing team-scoped GitHub read credential when available. Do not copy credentials to persistent state or borrow another team's identity. Existing verified caches remain readable without requiring a new credential.

The backend must fetch the captured URL directly, not an origin alias that can be retargeted between validation and fetch. Publish refs atomically with pruning, using the existing identity namespace. Preserve local branches, worktrees and unpushed objects. A failed fetch must not publish partial authority. Use the established bounded network execution and clear coalesced state on both success and failure.

Pin the repository binding through admission and commit resolution. Recheck it after preparation, and do not let a changed repoKind bypass the GitHub provenance guard. All six readers use the same admission boundary. Missing credentials and network failures remain explicit errors; there is no unchecked localPath escape hatch.

## Proof and rollout

Implementation starts only after coordinator review of this table. Add the live-shape success regression red first, with isolated Git remotes and no live writes. Retain the existing denial tests and add the inventory's concurrent, failed-fetch and retarget cases. Run targeted Vitest with maxWorkers=4, lint, typecheck, spec:parse and prepush, then current-head CI/cloud review. The owner repeats the original question after deployment. No manual live ref seeding or database correction substitutes for the regression.

Primary implementation references: [server admission and readers](../../apps/server/src/services/git.ts), [atomic daemon fetch](../../apps/daemon/src/git.ts), [identity namespace](../../packages/shared/src/repo-cache.ts), [workspace preparation](../../apps/daemon/src/workspace.ts), and [current regressions](../../apps/server/test/chief-docs.test.ts). This is a lifecycle repair of the existing mechanism, not a new protocol; no separate prior-art mechanism is proposed.

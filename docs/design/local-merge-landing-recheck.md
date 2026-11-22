# Local merge landing re-check (#5210)

Problem: a local merge's authorization is decided once, when a machine claims
the merge step (the local-merge block in `tryClaim`). The daemon then runs the
project's `localChecks` — up to 300 s each — and lands the squash commit on
the default branch with `landGitSquash`. A change to that authorization during
the checks — the task left review, was archived, or was superseded by a newer
build; the project's repo kind, base branch or `localChecks` changed; the step
was released — does not stop the landing. GitHub merges re-check the
checkpoint pin at merge time and hosted merges re-read the project target in
`applyMergeLanding` before `updateBranchRef`; the local path is the only one
that never asks again.

## Decision

After the local checks pass and immediately before `landGitSquash`, the daemon
asks the server whether the merge is still authorized. A refusal or no answer
stops the landing: the step reports `recheck` and nothing moves — the merge is
re-requested the same way any `recheck` outcome is today.

New machine-wire round-trip:

```
POST /api/machine/local-merge-recheck/:stepId        Bearer machine token
body   { command: LocalMergeCommand }
200    { authorized: boolean, reason?: string }
404    step gone or not claimed by this machine
```

The server answers with the same predicate the claim uses, now one function
`localMergeAuthorizationRefusal(db, command, todoRow)` shared by the claim
candidate scan, the claim transaction and this endpoint:

| Condition | reason |
|---|---|
| `todo.archivedAt` set | `task-archived` |
| `todo.latestBuildId` ≠ `command.buildId` | `build-superseded` |
| `todo.projectId` ≠ `command.projectId` | `task-moved` |
| `todo.phase` not `done`/`review`/`failed` | `task-phase` |
| project missing, `repoKind` not `local`, id ≠ `command.projectId` | `project-target` |
| `localChecks` differ from `command.localChecks` | `checks-changed` |
| `project.baseBranch` set and ≠ `command.defaultBranch` | `branch-changed` |

The endpoint adds its own guards ahead of the predicate: the step must be
`claimed` by this machine (`step-released`), carry a local-merge instruction
(`not-local-merge`), and the stored command must equal the one the daemon
holds (`command-mismatch`); a missing todo is `task-missing`. The issue text
still names `mergePolicy` and `quickLaneRefusal`; both were retired and the
predicate above is the live one.

## Paths

| # | Path | Reads | Writes | On failure |
|---|---|---|---|---|
| R1 | `landLocalMerge` (`apps/daemon/src/local-merge.ts`) | patch digest, base, worktree state, `shouldStop` | candidate commit, `update-ref` CAS, `refs/cairn/local-merges/<buildId>` receipt | any failed guard returns `held`/`recheck`/`checks-failed`; nothing lands |
| R2 | claim (`machine-claim.ts`) | the predicate on the candidate's todo/project | claims the step, or `failStepWithEvents` | refusal fails the step: "Local merge authorization changed; request the merge again" |
| R3 | re-check (`routes-machine.ts`, `services/local-merge.ts`) | the same predicate on fresh rows | none — a read | `authorized:false`, or 404 when the step is gone or not the caller's |
| R4 | step runner (`step-local-merge.ts`, `machine-client.ts`) | `claimed.localMerge`, the client's token | one POST per landing attempt | transport error, non-2xx or a missing endpoint is `authorization-unreachable` |
| R5 | report (`applyLocalMergeReport`) | the report's command vs `step.prompt` | step `done`, admission settled | `recheck` while the task is still `review` wakes the chief to re-request |

## Daemon

`landLocalMerge` gains an `authorize` callback run after the post-checks
`decideLocalMerge` and the worktree guards, immediately before
`landGitSquash`; `shouldStop` is consulted once more after the call returns.
`localMergeRecheck` on the machine client retries transport errors and 5xx on
`REMOTE_TOOL_RETRY_DELAYS_MS` (10 s timeout per try); 4xx answers at once. The
step maps `authorized:false` to `recheck` with reason
`authorization-<reason>` and every error, non-2xx or absent client method to
`authorization-unreachable` — fail closed in both directions.

## Failure behavior

- Refusal: `recheck` result; `applyLocalMergeReport` settles the admission
  refused, announces it, and wakes the chief while the task is still `review`
  so the merge is re-requested against the new state.
- No answer: server down, a non-2xx, or an old server without the route — the
  same `recheck` with `authorization-unreachable`. A new daemon against an old
  server never lands a local merge until the server is upgraded; the check is
  fail closed, never skipped.
- Old daemon, new server: the route is additive; an old daemon never calls it
  and lands as before. The window stays open for old daemons — no claim gate
  on `latestCliVersion` is added by this change.
- Residual window: the authorization can still flip between the
  `authorized:true` answer and `git update-ref`. The repo is local to the
  daemon so the server cannot gate the ref write; the re-check shrinks the
  exposed window from the checks' minutes to a single round-trip plus one ref
  update.
- Idempotency: the endpoint is a read, so the client retries it freely. A
  daemon restart mid-merge replays `landLocalMerge` from the journal and the
  re-check runs again on every attempt; a commit that already landed is
  recognized by the `refs/cairn/local-merges/<buildId>` receipt before any
  guard runs.

## Tests

- Daemon (`local-merge.test.ts`): authorization revoked during the checks →
  `recheck` and the ref unmoved; unreachable → `recheck` with
  `authorization-unreachable` and the ref unmoved; still authorized → lands as
  before; the callback runs after the checks and before `landGitSquash`.
- Daemon (`step-local-merge.test.ts` / `runner-local.test.ts`): a refusal from
  the client ends as a `recheck` report, and a merge on a FakeClient without
  the endpoint reports `authorization-unreachable`.
- Server (`local-merge-landing.test.ts`): the endpoint authorizes the claimed
  fixture; each mutation — phase, `latestBuildId`, `archivedAt`, base branch,
  `localChecks`, repo kind, a released step, a mismatched command — answers
  `authorized:false` with its reason; another machine's step is 404.
- Model (`verify-merge-gate`): `LocalLanding.tla` gains `authorized`,
  `rechecked`, `AuthorizeLanding` and `RevokeAuthorization`; `LandLocal`
  requires `rechecked` under `AuthRecheck`. P3G passes, P3H drops the guard
  and fails, P3R4 reaches a landing after `AuthorizeLanding`, P3R5 records the
  residual race — a landing is still reachable after `AuthorizeLanding,
  RevokeAuthorization`.

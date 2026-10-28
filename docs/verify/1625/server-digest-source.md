# #1625: the judged patch digest is read from the local repository

## Result

`integration/test/g2t2-local-lifecycle.test.ts` passes in full (5 tests, both
"autonomous local landing through claim and report" cases). The gate judgment and the
daemon's pre-merge inspection now compute the digest from the same facts, so the daemon
no longer answers `recheck/patch-stale`.

## Cause

`apps/server/src/services/local-merge-facts.ts` fed `computePatchDigest` a fixed
placeholder file record (`LOCALLY_DIFFED`, one fake file with zero hashes), while
`apps/daemon/src/local-merge.ts` `inspectLocalPatch` computed the digest from a real
`git diff <base>...<head>`. The two values cannot match for any non-trivial change, so
every autonomous landing was refused with `patch-stale`, the todo stayed in `review` and
the default branch never advanced.

## Fix

The server process already reaches the local repository: `builds.ts` `requestMerge`
calls `git.listBranches(projectRow.localPath)`, and for `repoKind: 'local'`
`cloneUrl === row.localPath`. So no machine protocol round-trip is needed.

- `GitOps` (`packages/shared/src/git-ops.ts`) gains
  `localCompareFiles(dir, base, head): Promise<CompareFile[]>`.
- `systemGitOps` (`apps/server/src/lib/git.ts`) implements it with the same git
  invocations, statuses, blob SHAs and patch SHAs as the daemon's `inspectLocalPatch`.
- `localGateFacts` is async and feeds those real files to `mergeReadiness`; a missing
  checkout, an unreadable diff or a null boundary fails closed to `compare: 'malformed'`
  instead of fabricating a patch.
- `enqueueLocalMerge` and its caller await it.

`readiness.patchDigest` is the real digest, so verdict binding, the persisted gate state
and the `judgedPatchDigest` sent to the daemon are all consistent.

## Evidence

- `apps/server/test/local-merge-local-digest.test.ts` (new): builds a real temp
  repository, computes the daemon digest with `inspectLocalPatch` and the server digest
  through `localGateFacts`, and asserts they are equal; a second case moves the head and
  asserts the server digest follows the new head. Both were red before the fix
  (`expected undefined to be 'pd2:e70a37f7…'`) and are green after it.
- `pnpm --filter @cairn/server exec vitest run` — 182 files, 2969 tests pass.
- `cd integration && pnpm exec vitest run test/g2t2-local-lifecycle.test.ts` — 5 tests
  pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm spec:parse`,
  `node scripts/single-use-helper-gate.mjs` all pass.

## Negative control

Restoring the placeholder makes the new parity test red: the server would report
`pd2:4b90e605…` for a change whose daemon digest is `pd2:e70a37f7…`, and the integration
lifecycle test returns to `expected 'review' to be 'done'`.

## Follow-up, not part of this fix

The persisted gate verdicts of a real local build carried `patchDigest: null` because
nothing on the server could compute it. With the digest now readable, that gap closes
for new judgments; historical verdict rows are unchanged.

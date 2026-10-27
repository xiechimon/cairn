# Issue 1753 verification

Verified the uncommitted worktree on `lane/1753`. No network access, dependency installation, or Git commit was used.

## Negative controls

- `default-red.log`: new-project creation returned `human` instead of `autonomous` before changing the default.
- `review-red.log`: the original gate returned `protected-path` or `test-deleted`, did not require independent review metadata, and did not block affirmative mandatory answers. The new acceptance cases failed before implementing the gate changes.
- `prompt-red.log`: the rendered chief system prompt lacked autonomous merge guidance.
- `questions-red.log`: the review schema dropped the two answers and the review prompt did not request them.

## Final checks

All test and heavy check commands ran under `flock --close /tmp/cairn-heavy.lock`.

- `tests.log`: 490 tests passed across 13 files, covering project creation and legacy policies, readiness, status, path classification, verdict binding, chief prompts and wakes, issue fencing, server and daemon review, and shared schemas.
- `lint.log`: `pnpm lint` exited 0; two informational diagnostics remain in untouched files.
- `typecheck.log`: `pnpm typecheck` passed across every workspace, including integration tests.
- `pnpm spec:parse` could not complete because the sandbox returned `spawnSync pnpm EPERM`. Its underlying Playwright collection was run directly with `pnpm --dir apps/web exec playwright test --list`: 1267 tests in 180 files, matching all 180 spec files on disk. Integration parsing is covered by the successful integration typecheck above.
- Two shared snapshots were regenerated after observing their failures: the machine-done review-answer fields and the blocker vocabulary.
- `git diff --check` passed.

## Storage and compatibility

Project merge policy lives in nullable JSON without a stored SQL default. Changing the shared read-time default covers new projects and existing projects with no stored policy, so no Drizzle migration is needed. API tests verify both legacy forms and preserve explicit `human` and `shadow` policies.

Legacy review records remain readable. Missing author identity/model, reviewer identity/model, current-head binding, current-patch binding, or either mandatory answer cannot satisfy independent review. An affirmative answer blocks even alongside another passing review at that head.

## Additional check limitations

The language and comment gate wrappers returned `spawnSync git EPERM` in this sandbox. The added code contains no standalone comments. The lessons-ledger checker reports the same two existing errors on both HEAD and this worktree; this change adds no ledger violations.

The ADR file is intentionally absent from this branch. Automatic npm publishing and the weekly sample of at least five autonomous PRs remain follow-up work.

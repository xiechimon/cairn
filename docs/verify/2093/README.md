# Issue #2093 verification

The new guidance-contract tests failed before the documentation change: 17 passed and 3 failed. After the correction, all 20 tests passed. The workflow and its behavioral tests are unchanged.

- [Failing guidance test summary](red.txt)
- [Passing policy and behavioral tests](green.txt)

The behavioral suite executes the workflow shell against temporary Git repositories. It rejects forbidden author names and emails, squash commits, forbidden commits beneath human tips, and missing or zero previous-SHA fallbacks. It accepts clean authors and a compliant push whose historical bot commit is outside the pushed range.

Additional checks passed: `pnpm lint`, `flock /tmp/cairn-heavy.lock pnpm typecheck`, and `pnpm spec:parse` (1373 web cases collected and 51 integration test files parsed). Lint reported one existing informational `useFlatMap` diagnostic in `apps/server/test/feishu-config.test.ts`. English-only, single-use-helper, and comment-discipline gates reported zero violations. `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs` exited successfully with no related Vitest files selected; the script tests above run through Node's test runner.

Open PR #2090 touches the identity document and policy tests. Its range clarification is preserved verbatim; the new tests and preparation instructions are additive to that work. Open PR #1848 adds overlap instructions to the PR skill; these changes leave its insertion point intact. Recently merged #2033's enforcement and test coverage and #2051's PR instructions remain intact. The obsolete commit-wrapper example is corrected as requested by #2093.

No server was started. No push, merge, or history rewrite was performed. The external dispatcher helper is outside the checkout and was not inspected or changed. A future authorized merge must verify the actual main commit author and Actions result; these local checks do not establish that main is green.

## Preparation recipe review correction

The executable regression test extracts the documented shell recipe and runs it in a temporary Git repository with inherited bot author, bot committer, and both identities. It inspects the resulting commit's author and committer names and emails and checks that the documented inspection prints both. The old recipe fails on actual commit identity; explicit environment assignments pass all three scenarios. Both identity wrappers are excluded from preparation.

- [Review regression failures](review-red.txt)
- [Review policy and workflow results](review-green.txt)

Review item 5 remains an external acceptance blocker: this correction tests the preparation recipe, but cannot enforce the external dispatcher's merge method or demonstrate a green main push. No authorized push or merge occurred. The repository workflow and behavioral enforcement tests remain unchanged. Dispatcher enforcement and post-merge Actions verification are still required before claiming the incident resolved.

Review validation passed: 21 Node tests, `pnpm lint` (one existing informational diagnostic), `flock /tmp/cairn-heavy.lock pnpm typecheck`, `pnpm spec:parse` (1373 web tests and 51 integration files), and `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs` (exit 0; no related Vitest files). English-only, single-use-helper, and comment-discipline gates each reported zero violations. The lessons ledger and `git diff --check` passed. Per the sandbox handoff, `COMMIT_MSG.txt` contains the complete commit message ending in `Closes #2093`; staging and committing are left to the dispatcher.

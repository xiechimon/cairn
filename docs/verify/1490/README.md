# #1490 evidence: an accepted stop reaches the step

- `before-fix-tests.txt`: the new stop tests run against origin/main's `apps/daemon/src` (red), plus mode 5c run against 996daa64.
- `after-fix-tests.txt`: the same test files on this branch (green).
- `run-full.txt`: `.claude/skills/verify-step-claim/scripts/run.sh`, all four properties PASS and match `expected.txt`.
- `p4-breaks.txt`: P4 with one part of the fix undone in a copy of the model; each variant produces a counterexample.
- `full-suites.txt`: daemon suite and the server/integration stop suites, with the unrelated environmental failures named.

# Issue 1792 verification

The worktree already contained the public Harbor implementation when this
verification started. Existing changes were preserved, including an unrelated
pnpm lockfile modification that must be excluded from the task commit.

## Tests first

- `scan-red.log`: two failures before correcting Go and Python suffix test paths.
- `outcome-red.log`: a normal source edit incorrectly voided a successful trial.
- `python-green.log`: all 70 Python tests pass after those corrections.
- `prepush-vitest.log`: exits successfully with no affected JavaScript tests.

Repository lint, typecheck, and spec collection passed. The language,
single-use-helper, and comment gates each reported zero violations.

## Runtime acceptance remains incomplete

Docker reports version 29.9.1. The user systemd bus is unavailable:
`systemctl --user is-system-running` reports missing runtime and bus variables.
No benchmark servers or trials were started during this verification.

There are no raw step-1 measurement outputs or baseline trial artifacts in this
worktree. The README's unsupported drafted measurements were replaced with an
explicit execution status. No benchmark pass rate, paid-run cost, issue comment,
or public upload was produced.

The current runner cgroup also excludes Docker task containers. Container memory
accounting and enforcement must be resolved before resource acceptance.

Open PR 2049 touches other Harbor files; no overlapping public benchmark file was
found. Recently merged PR 2059's submission implementation was left intact.

## Review corrections

The review regression suite first produced 8 failures and 68 passes
(`review-red.log`), then 76 passes (`review-green.log`). It covers evaluator
guidance leakage, auxiliary rewards, partial report counts, missing seed,
declared harness-session ingestion through outcome collection, URL boundaries,
and missing or empty datasets. Existing ordinary source-edit coverage remains
green. No benchmark trials or servers were started.

The benchmark guidance was removed from arm B's prompt and skill; evaluator
rules remain external and identical for both arms. Harness-session provenance
is explicit through a per-trial manifest rather than inferred from normal logs.
The root README was left unchanged: open PRs #1995 and #1727 overlap that file,
and recently merged #2026 added Community content. No lines from those changes
were removed. No open PR overlaps the public benchmark implementation.

The issue's first two acceptance items remain unmet. This is not an approved
scope reduction; the owner decision is recorded in the public benchmark README.

Final checks: Python 76 passed; lint passed with one existing informational
finding in `apps/server/test/feishu-config.test.ts`; typecheck and spec parsing
passed. `prepush-vitest.mjs` exited 0 with no affected JavaScript tests. The
English, single-use-helper, and comment gates each reported 0. Heavy checks
were serialized with `flock /tmp/cairn-heavy.lock`. The lessons ledger and
`git diff --check` passed.

Per the sandbox handoff instruction, no git staging or commit was attempted.
`COMMIT_MSG.txt` contains the requested message ending in `Closes #1792`.

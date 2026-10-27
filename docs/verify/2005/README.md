# Baseline ownership gate

The test suite was written and run before the implementation. `red.log` records the missing module failure; `green.log` records all ten passing pure-function tests, including the unlabelled baseline change negative control and its main-red positive control.

The protected set is derived from `METRICS` in `scripts/baseline-ledger.mjs` plus `scripts/prepush-known-red.json`. `scripts/ci-job-structure-baseline.json` is deliberately excluded: every PR that adds a CI job must register that job there, so protecting it would make the gate block its own feature PRs and every later gate addition. It pins step placement rather than a tunable threshold, and `scripts/ci-job-structure-gate.mjs` already fails when a job is missing from it.

The CI job compares the PR base and head with rename detection disabled, so renamed or deleted protected files remain subject to ownership checks. GitHub label lookup failures fail closed. Ordinary changes do not perform label lookups.

The workflow has a separate `baseline-owner-gate` status. Repository administrators must require that status in branch protection; this worktree change does not modify repository settings.

Open PR #1992 overlaps the workflow and CI structure baseline. Open PR #1787 overlaps the workflow. This patch adds a job and its baseline entry without reverting their lines.

Local verification: CI's red prepush self-test was reproduced locally (prepush.test.mjs reported `scripts/baseline-owner-gate.mjs runs in CI but not in local prepush`), fixed by listing the gate in `ciOnlyScripts` in `scripts/prepush.mjs` — it reads the PR event payload and issue labels through the GitHub token, so it cannot run locally — and re-verified green: 16 prepush self-tests, the 13 ownership tests, CI structure gate, ratchet gate, lint, spec parse and typecheck. The 13 ownership tests include the bootstrap negative control: a PR that edits `ci-job-structure-baseline.json` without a `main-red` issue must pass, while `lint-warning-baseline.json` in the same position must still fail. Heavy commands ran under `flock /tmp/cairn-heavy.lock`; no servers were started. Required-status repository settings remain outside this worktree change.

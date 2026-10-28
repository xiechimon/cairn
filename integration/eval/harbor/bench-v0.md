# pacman-bench v0 candidate audit

Status: incomplete. There are zero accepted tasks. The manifest is an audit of
972 merged PRs, not a completed benchmark. Fifty-three PRs passed initial static
selection. No oracle or independent label has been recorded as passing.

The implementation follows the owner's acceptance comment on issue #1517 dated
2026-10-27 ([source](https://github.com/xiechimon/cairn/issues/1517#issuecomment-6444474886)): Harbor 0.25.0, merge date on or after 2026-07-01, exactly one
`closes #N` reference in the merge commit, at least one regression-test change,
and 20–400 non-test changed lines. Evaluation changes, Playwright/e2e changes,
and documentation-only changes are excluded. Binary non-test diffs are rejected
because their line count cannot meet a verifiable textual bound. The date is an
owner-selected cutoff, not an independent claim about model training data.

`bench-v0.json` records each examined PR and its exclusion reason. Eligible rows
still require offline dependency review, paired controls, and two independent
labels. A network-dependent test cannot be retained: verification has no network.
Missing modules, timeouts and dependency failures are infrastructure errors;
they are never a successful nop rejection.

Partition rule `issue-parity-v1`: even issue numbers use `optimize`; odd issue
numbers use `holdout`. Conversion writes the partition into provenance once.
Reordering candidate discovery does not change an existing assignment.

## Reproduce

Run from the repository root. Git objects for merged commits must already exist
locally; discovery reports unavailable objects instead of guessing a base.

```sh
python3 integration/eval/harbor/pr-to-task.py --discover --limit 2000 --output /tmp/candidates.json
python3 integration/eval/harbor/pr-to-task.py --pr 1990 \
  --test-command-json '["node","--test","scripts/test-tmpdir.test.mjs"]' \
  --output /tmp/task-1990
flock /tmp/cairn-heavy.lock env \
  UV_CACHE_DIR=/tmp/cairn-1517-uv \
  UV_TOOL_DIR=/tmp/cairn-1517-tools \
  UV_TOOL_BIN_DIR=/tmp/cairn-1517-bin \
  DOCKER_CONFIG=/tmp/cairn-1517-docker \
  python3 integration/eval/harbor/pr-to-task.py \
  --check /tmp/task-1990 --output /tmp/controls-1990
uv run --with pytest pytest integration/eval/harbor/test_pr_to_task.py
pnpm --filter @cairn/integration exec vitest run test/bench-v0-manifest.test.ts
```

Use a new output path for each conversion and trial pair. Conversion refuses to
overwrite an existing directory. Test commands are explicit JSON argument arrays
reviewed against changed tests; instruction text never supplies executable commands.
The converter produces a base-only Git archive with no `.git` history. Only the
`environment/` directory is the Docker build context. The test and product patches
live in separate sibling directories, injected by Harbor during verification and
oracle execution respectively. The issue body is preserved inside a fence longer
than any backtick run in the body. It is data, not harness instructions.

Dependencies are installed during image build with `--ignore-scripts`, in keeping
with the repository's prohibition on running package lifecycle scripts without
explicit authorization. Candidates needing native build scripts remain ineligible
until their build is authorized and independently reproduced. No verifier install
or download is permitted. Compose sets `network_mode: none` for both controls.

The local fixture executes the separated patches in fresh directories: the original
product patch passes and the empty product patch fails an actual assertion. This
proves patch separation locally; it does not replace real Harbor/image acceptance.

## Observed blockers

`ai-route pick review` fails because `/home/ian/.cache/ai-route/codex.json` is read
only in this sandbox. The configured cross-vendor labelers have not run. No model
verdict has been invented or substituted. Labelers must receive the instruction
and test patch, without the solution. Reject disagreements without relabeling.

The first real Harbor 0.25.0 oracle/nop pair for PR #1990 failed in Docker build
setup because `/home/ian/.docker/buildx/activity/` is read only. Both results are
infrastructure failures even though Harbor exits with code zero. See
`docs/verify/1517/1990-oracle-infrastructure.log` and
`docs/verify/1517/1990-nop-infrastructure.log`. A retry with an isolated writable Docker configuration was canceled while
waiting for the shared heavy-check lock, before starting Harbor. That alternative
is unverified. The first pair took 15.987 seconds for oracle and 4.421 seconds for
nop, including framework startup/cleanup; neither reached test execution. The
generated base archive was 177592320 bytes. No task image or valid test-run disk usage
measurement exists, so no container acceptance is claimed.

## Candidate counts

- Binary non-test diff: 401.
- Contains Playwright or e2e tests: 40.
- Initial eligibility only: 53.
- No added or changed regression tests: 40.
- Non-test diff outside 20-400 lines: 57.
- Only documentation or tests change: 30.
- Requires exactly one closes #N issue reference: 338.
- Touches the evaluation surface: 13.

## Proposed owner spot-checks

Seed 1517 selects these five initial candidates without replacement. They are
proposals, not accepted tasks; owner acceptance remains unperformed.

- PR #1559: https://github.com/xiechimon/cairn/pull/1559
- PR #1538: https://github.com/xiechimon/cairn/pull/1538
- PR #1905: https://github.com/xiechimon/cairn/pull/1905
- PR #1645: https://github.com/xiechimon/cairn/pull/1645
- PR #1735: https://github.com/xiechimon/cairn/pull/1735

## Failure modes

Selection rejects ambiguous issue references, unavailable revisions, out-of-range
changes and unsuitable test families. Conversion checks unsafe archive paths and
link escapes, separates test/product patches, and prevents overwrites. Controls
distinguish failed assertions from missing dependencies and framework errors.
Image leakage, offline execution, flaky tests and semantic label agreement still
require real-container and independent-vendor evidence before any task is kept.

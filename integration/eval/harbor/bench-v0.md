# pacman-bench v0 candidate audit

Status: incomplete. There are zero accepted tasks. The manifest is an audit of
972 merged PRs, not a completed benchmark. Fifty-three PRs passed initial static
selection. One probe task (PR #1562) has passing paired controls and one label; no
task is kept.

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
python3 integration/eval/harbor/pr-to-task.py --pr 1562 \
  --test-command-json '["node","--test","scripts/single-use-helper-gate.test.mjs"]' \
  --output /tmp/task-1562
env \
  UV_CACHE_DIR=/tmp/cairn-1517-uv \
  UV_TOOL_DIR=/tmp/cairn-1517-tools \
  UV_TOOL_BIN_DIR=/tmp/cairn-1517-bin \
  DOCKER_CONFIG=/tmp/cairn-1517-docker \
  python3 integration/eval/harbor/pr-to-task.py \
  --check /tmp/task-1562 --output /tmp/controls-1562
python3 integration/eval/harbor/label-task.py /tmp/task-1562 --model gpt-6.1-sol \
  --output /tmp/label-1562.json
cd integration/eval/harbor && uv run --with pytest pytest test_pr_to_task.py \
  test_control_probe.py test_label_task.py
pnpm --filter @cairn/integration exec vitest run test/bench-v0-manifest.test.ts
```

`--check` takes `/tmp/cairn-heavy.lock` itself (override with `CAIRN_HEAVY_LOCK`),
so do not wrap it in `flock`; lock wait is recorded apart from Harbor wall time.
Set `DOCKER_CONFIG` only when the default Docker config directory is read-only.
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

PR #1562 is the Epic 0 runner probe. On the shared Linux host, Harbor 0.25.0
ran the oracle (reward 1, pass) and the `nop` agent (reward 0, classified as an
assertion failure) with `network_mode: none`; Docker's actual NetworkMode was
read from live containers and is `none` for both. The parent process wrote each
trial's `outcome.json`; the agent directory holds no reward file. One label from
OpenAI was produced by invoking `codex exec` directly, never through `ai-route`
(`route: direct-codex-exec`). A kept task still needs a second accepting label
from a different vendor, so the manifest stays incomplete. Evidence:
`docs/verify/1518/epic0/`. Timing per control splits lock wait, Harbor wall time,
image build (Harbor `environment_setup`), and trial container CPU from cgroup
`cpu.stat` samples taken every 0.25 seconds (a lower bound; build CPU excluded).

PR #1990 is not a usable probe: its test file imports a module that the base
revision does not contain, so `nop` fails with a missing module, which is
classified as infrastructure, not an assertion. Its earlier failure
(`docs/verify/1517/1990-*-infrastructure.log`) was a read-only Docker buildx
directory in a sandbox. The converter now needs a writable `DOCKER_CONFIG`
only on hosts whose default Docker config directory is not writable.

## Epic 1: trustworthy scoring

Generated tasks grade in a separate verifier container (`environment_mode =
"separate"`). The agent container never holds `/tests`, the solution or the
reward. A `[[verifier.collect]]` hook publishes `/app` minus `node_modules` and
`.git` to `/logs/artifacts/workspace`; Harbor uploads that directory into a fresh
verifier container whose image, runtime and dependencies the agent could not
touch. `tests/test.sh` then drops planted `node_modules`/`.git` and deletes every
workspace file matching the test-infrastructure pattern in `tests/protected-regex.txt`
(package.json and lockfiles, vitest/vite/jest/playwright config, setup and workspace
files, `tsconfig*`, `*.test.*`, `*.spec.*`, `test_*.py`, `conftest.py`, and anything
under `test/`, `tests/`, `__tests__/`, `e2e/`, `fixtures/`), except paths the gold
solution patch modifies (`tests/solution-paths.txt`). The pristine image supplies the
base versions, so edited files revert and planted ones vanish;
`tests/protected-paths.txt` lists the base files protected. It then applies
`tests/tests.patch`, runs the explicit command and only then writes `1` to the reward
file, which Harbor itself clears first. The test command is a caller-supplied
argument array and is not rewritten to name a config.
Only the parent process writes `outcome.json`; the probe flags any outcome-like
file under the trial's `agent/` directory or the published artifact root.
Limitations: files deleted by the agent are not propagated, and helper files outside
the pattern are treated as product code.

Four cheat agents (`cheat_agent.py`, scripts in `cheat_controls.py`) run as real
Harbor trials. Each is blocked only when the trial is scored 0 on a real
assertion, every container had network mode `none`, the parent wrote the outcome,
and the cheat's own evidence proves it executed:

- `git`: `git log --all`, `show`, `reflog`, `rev-list`, `fsck`, `cat-file` of the
  base commit, plus a filesystem search for `.git`, packs and a line unique to
  the fix. All fail and nothing is found.
- `bash`: overwrites the test file, rewrites `vitest.config.*`, plants `vitest.setup.ts`, pre-seeds `reward.txt`/`reward.json`, plants
  `/tests/test.sh` and replaces the `node` binary.
- `forge`: writes `outcome.json`, `result.json`, `reward.*` into every writable
  location; the probe flags it and the outcome stays the parent's.
- `network`: `curl`, `npm view`, Python, `getent`, Node DNS and a raw TCP connect
  all fail; no default route and only `lo`.

```sh
python3 integration/eval/harbor/pr-to-task.py --pr 1562 \
  --test-command-json '["node","--test","scripts/single-use-helper-gate.test.mjs"]' \
  --output /tmp/task-1562
python3 integration/eval/harbor/pr-to-task.py --cheat-controls /tmp/task-1562 \
  --output /tmp/cheats-1562
python3 integration/eval/harbor/pr-to-task.py --check /tmp/task-1562 \
  --output /tmp/controls-1562-e1
```

Evidence: `docs/verify/1518/epic1/` (recorded before the protected-pattern restore and the config and setup tampering in the `bash` cheat; it needs a re-run), including a counterfactual: the same `bash` cheat (runtime replaced, no test edit) against the earlier shared-verifier task scores reward 1, and against the separate verifier scores 0. The task stays unaccepted; Epic 1 proves the
ruler resists these four cheats, not that PR #1562 is a kept benchmark task.

## Epic 2: conversion and labels

Discovery now covers every merged PR through #2766 (1370 examined; the 398 PRs
after #2045 were scanned with the same owner rules). The new range gives 29 more eligible
PRs, 82 in total. PR #2118 could not be examined because its merge commit is not in the
repository (recorded as a discovery failure).

All 82 eligible PRs converted with `batch_tasks.py convert` (task `task-<PR>`, test
command derived from the changed test files: `node --test` for `node:test` files,
`pnpm exec vitest run` for the rest, chained with `sh -c` when mixed). Conversion
failures: 0. Static checks without Docker: every `tests.patch` applies to the base
archive and every `solution.patch` applies on top; the grader, solution, protected-path
and protected-regex lists are non-empty in all 82. Five gold solutions touch protected
infrastructure (`package.json` or `pnpm-lock.yaml`: PRs 1552, 1641, 1716, 1824, 1905);
they are listed in `solution-paths.txt` as designed. 21 tasks were flagged for
network-looking text in the test patch (URL strings, `gh`/`npx` text); inspection of the
first batch shows URL fixtures and mocks. None is confirmed network-dependent, and none
was run, since Docker was unavailable.

Labels use the graded rubric `graded-v1` (`gpt-6.1-sol`, direct `codex exec`): the model
scores `underspecification` and `testValidity` from 0 to 3 with written definitions and a
reason for each, and code computes `accept` only when both scores are at most 1. The
earlier binary labels are kept as `label.openai.binary.json`. Graded rubric: 12 accepted,
70 rejected (binary rubric: 10 accepted).
`underspecification` distribution (0/1/2/3): 30/50/2/0.
`testValidity` distribution (0/1/2/3): 2/10/59/11.
Thirty accepted tasks are not yet reachable from this pool.

The tasks live in the private repository `xiechimon/cairn-eval-tasks` (commit
`9fcd6494641667034f8546393acf6bce7ec2f103`), without `base.tar`, which
`regenerate-base.sh` rebuilds from `git archive` and checks against stored digests.
Per-PR status is in the `conversion` section of `bench-v0.json`. Controls (oracle, nop,
cheats) are pending; `complete` stays false and `tasks` stays empty.

Later, run the controls over every accepted task, one at a time:

```sh
python3 integration/eval/harbor/batch_tasks.py controls-script \
  --tasks ~/cairn-eval/tasks/v0 --output ~/cairn-eval/controls > /tmp/controls.sh
sh /tmp/controls.sh
```

Each line takes `flock /tmp/cairn-eval-batch.lock`. `pr-to-task.py` takes
`/tmp/cairn-heavy.lock` itself, so wrapping it in `flock /tmp/cairn-heavy.lock` would
deadlock; failures append to `failures.txt` in the output directory.

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

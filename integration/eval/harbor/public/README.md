# Cairn public benchmark spike (issue #1792)

Runs Cairn on public benchmarks through [Harbor](https://github.com/laude-institute/harbor) 0.25.0 (pinned in `pyproject.toml`), so Cairn can be compared with other agents on the same model: SWE-bench Verified and Terminal-Bench 2.1.

This is a developer-side spike for omarchy. Nothing here ships in the product install.

## Layout

- `cairn_harbor/cairn_executor.py`: `CairnExecutor`, the arm-B agent. A subclass of Harbor's installed `Pi` agent that uploads the Cairn worker system prompt (read from `cairn_harbor/cairn-worker-prompt.md` at run time) into the task container and appends it with pi's `--append-system-prompt <path>`. Skills are injected through Harbor's `skills` agent option (`skills/cairn-worker/SKILL.md`); no runner or dataset conversion is written.
- `cairn_harbor/subset.py`: fixed-seed draw of 20 SWE-bench Verified + 20 Terminal-Bench 2.1 task ids.
- `subset-1792.json`: the committed task list. The SWE half is drawn with seed 1792, the Terminal-Bench half with seed 1793 (`seed + 1`).
- `dataset-index.json`: the sorted task-id index of the pinned datasets (500 SWE-bench Verified, 89 Terminal-Bench 2.1 tasks), so the committed subset can be checked offline against real ids.
- `cairn_harbor/scan.py`: reward-hacking scan over a trajectory (see below).
- `cairn_harbor/report.py`: per-arm report with Wilson intervals.
- `cairn_harbor/costs.py`: per-trial cost reading (tokens, wall time, infra failures).
- `cairn_harbor/run_baseline.py`: CLI driver (select / job-config / run).
- `results/`: output destination for future measured reports; no baseline report is committed.

## Prerequisites (omarchy)

- Docker running, `systemd-run --user` available.
- Datasets downloaded once:

```sh
cd integration/eval/harbor/public
uv run harbor download swebench-verified --export -o /tmp/harbor-1792
uv run harbor download terminal-bench/terminal-bench-2-1 --export -o /tmp/harbor-1792
```

- A free pi channel. This spike used `reflection/beam:free` on `https://api.commandcode.ai/provider/v1` (OpenAI-completions API), the same model and channel for arms A and B. Export its key:

```sh
export OPENAI_API_KEY=<commandcode key>
```

Relay-186 is never used for claude-* models (issue constraint).

## Commands

```sh
cd integration/eval/harbor/public
uv sync
uv run pytest

# draw the fixed subset (already committed as subset-1792.json)
uv run python -m cairn_harbor.run_baseline select \
  --swe-dir /tmp/harbor-1792/swebench-verified \
  --tb-dir /tmp/harbor-1792/terminal-bench-2-1 \
  --seed 1792 --out subset-1792.json

# write a harbor job config (arm: pi | cairn | oracle)
uv run python -m cairn_harbor.run_baseline job-config \
  --tasks subset-1792.json --datasets-dir /tmp/harbor-1792 \
  --arm cairn --job-name baseline-B --out /tmp/harbor-1792/baseline-B.yaml

# run it under a memory-limited systemd scope (concurrency <= 3)
uv run python -m cairn_harbor.run_baseline run \
  --config /tmp/harbor-1792/baseline-B.yaml \
  --tasks subset-1792.json \
  --jobs-dir /tmp/harbor-1792/jobs \
  --arm-label B --job-name baseline-B \
  --n-concurrent 3 --memory-max 20G \
  --out-dir results
```

`run` wraps harbor in `systemd-run --user --wait --pipe -p MemoryMax=<limit>`, samples `docker stats` every 15 s while the job runs, reads the unit's `MemoryPeak` afterwards, and writes `results/<arm>.json` plus `results/<arm>.report.md`. Infra failures (trial exceptions) are counted separately from agent failures.

## Arms

- A, control: Harbor's built-in `pi` agent, no Cairn code.
- B, Cairn executor: `CairnExecutor` (`cairn_harbor.cairn_executor:CairnExecutor`) installs Cairn's worker system prompt and skills into the task container. This is the adapter #1518 reuses.
- C, full Cairn: deferred (issue text).

Arm B adds the Cairn working loop only. Neither its prompt nor its skill discloses
the evaluator's test-edit or benchmark-access rules. The same external scan
applies to both arms; arm A remains Harbor's unmodified built-in pi agent.

## Reward-hacking scan

Every trajectory is scanned (`cairn_harbor/scan.py`); a flagged trial is voided and counts as a scored zero in the pass-rate denominator (infrastructure failures stay excluded and are counted separately):

- `edit-test-file`: an edit/write tool call whose target path is a test file or under a `tests/` tree (`conftest.py`, `test_*.py`, `*_test.py`, `test.sh`, grading `config.json`).
- `benchmark-site-access`: a tool call that touches a benchmark host (`tbench.ai`, `t-bench.org`, `terminal-bench.org`, `terminalbench.com`, `swebench.com`, `swe-bench.github.io`, the laude-institute / SWE-bench GitHub repos, or their Hugging Face datasets).
- `harness-session-edit`: tool calls in an explicitly declared ingested harness trajectory. Pass `--harness-sessions <manifest.json>` to `run`; the manifest maps trial directory names to lists of absolute session file paths. Missing files are rejected before a job starts. Ordinary agent logs are never classified as harness trajectories merely because they contain source edits.

The negative control is `tests/test_scan.py::test_write_to_conftest_is_flagged` and friends; see `docs/verify/1792/`.

Only the headline `verifier_result.rewards.reward == 1.0` counts as a pass;
auxiliary reward fields cannot change the verdict. Reports use the required
`--tasks` subset for the seed and planned task list, and show collected trial
counts separately so interrupted runs cannot appear complete. Python checks
live under `tests/` and are collected by `uv run pytest`.

## Execution status

Step 1 and the 80-trial baseline are not verified. No raw trial outputs or
measurement artifacts are present in this worktree. Previously drafted numbers
have been removed because they cannot be supported by raw evidence.

The current execution environment has Docker 29.9.1, but `systemctl --user
is-system-running` fails because `DBUS_SESSION_BUS_ADDRESS` and
`XDG_RUNTIME_DIR` are not defined. Do not launch benchmark jobs without the
required memory-limited execution environment.

The committed subset describes the planned 40-task spike, k=1, for arms A and B.
It is not a completed baseline. No pass rate, cost estimate, public upload, or
issue measurement comment is claimed. Terminal-Bench results require k=5;
one-attempt diagnostics must always be labelled "spike, k=1".

Before publishing results, verify the free channel, repair resource accounting
so task containers are included, scan every trajectory, and preserve raw Harbor
trial outputs. The runner's systemd unit currently limits its own process tree;
Docker containers started by the Docker service are outside that unit.

Acceptance remains blocked, not reduced: ian must decide whether to supply an
omarchy execution environment with container-inclusive memory enforcement and
complete steps 1–3, or explicitly accept a separate adapter-only delivery.
No `results/<date>-baseline.md` can be produced before measured trials exist.

## Regression gate (C2 Epic 4)

`cairn_harbor/gate.py` compares a base harness with a candidate harness on the same task set, and `.github/workflows/eval-gate.yml` runs it for pull requests.

Harness definition: `harness-paths.json` lists the harness files (the Harbor cairn executor, its prompt and skill). The scan policy in `constants.py` is ruler, so changing it refuses the gate. Product paths (the Chief, the pi backend) are left out until the executor runs the product daemon (Epic 3), because a comparison that never executes them would be no evidence. `python -m cairn_harbor.gate trigger --files <changed-files.txt>` exits 0 only when a diff touches one of them, and the workflow path filters are held equal to the list by `tests/test_harness.py`. A diff touching none does not start the gate.

Inputs: one `run_baseline run` result file per repeat and arm. Each file pins `model`, `task_set_sha` (SHA-256 of the `--tasks` file), `harness_sha` (SHA-256 over the harness files) and the budget `run_id`. A differing model or task set between arms, or a missing pin, is refused (exit 2).

Pairing follows `integration/eval/adoption/judge.mts`: pairs are on matching tasks; an infrastructure trial is dropped, and a task with no scored trial on a side is excluded, never counted as a regression; a voided trial stays a scored zero.

MDE: for each paired task `t`, `s2_t` is the sample variance of the unchanged harness's pass scores over its repeats, `nb_t` and `nc_t` are the scored trials per side, and `N` is the number of paired tasks.

```
SE  = sqrt(sum_t(s2_t * (1/nb_t + 1/nc_t))) / N
MDE = max((1.96 + 0.8416) * SE, 1 / (N * candidate repeats))
```

That is a two-sided 5% test at 80% power; the floor is one flipped trial. `delta` is the mean over paired tasks of the candidate pass rate minus the base pass rate.

Verdicts: `better` when `delta >= MDE`; `worse` when `delta <= -MDE`; `no-detectable-difference` between; `broken` when the candidate completed no agent run (every trial infrastructure or zero tokens); `insufficient-data` with fewer than 5 base repeats or fewer than 5 paired tasks. The gate blocks on `worse`, `broken` and `insufficient-data`. Exit codes: 0 pass, 1 blocked, 2 refused.

Controls (`tests/test_gate.py`, synthetic fixtures shaped like `run_baseline` output): a known-better harness is `better`, an identical harness is not blocked, and a candidate whose agent never runs is `broken`.

The results file records `model`, `taskSetSha`, `harnessShaBase`, `harnessShaCandidate`, repeats, `delta`, `mde` and `costUsd` (the sum of the budget ledger settlements of the runs; `null` with `unsettledRuns` when any run is unsettled).

Workflow: runs on a self-hosted Linux runner labelled `cairn-eval` (Harbor needs Docker, `systemd-run --user` and the datasets directory, which GitHub-hosted runners lack), only when the PR carries the `eval-gate` label and comes from this repository, or by `workflow_dispatch`. `CAIRN_EVAL_ANTHROPIC_API_KEY` is exposed to the run step only, `--max-run-usd` is mandatory, and `eval-gate-results.json` is uploaded as an artifact. Runner setup: `CAIRN_EVAL_DATASETS_DIR` and `CAIRN_EVAL_GATE_MAX_RUN_USD` repository variables.

Not yet exercised: no metered run has happened. `job-config` still builds the free-channel model and `run_job` forwards only `OPENAI_API_KEY`, so wiring the metered model and the Anthropic key name into the executor is required before the first real gate run.

Ruler integrity: the trigger, `ruler` check and judge run from a checkout of the default branch, never from the PR. `python -m cairn_harbor.gate ruler` refuses (exit 2, `refused: ruler changed`) when the base..candidate diff touches a ruler path (`integration/eval/**` minus the harness paths in `harness-paths.json`, and `.github/workflows/eval-gate.yml`), or when either arm checkout's ruler files differ from the default branch's. A diff touching no harness path ends the job green with a "not triggered" notice and skips the later steps.

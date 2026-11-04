import json
from pathlib import Path

import pytest

from cairn_harbor import budget, gate

MODEL = "claude-test-1"
TASKS = "a" * 64
BASE_SHA = "b" * 64
CAND_SHA = "c" * 64
TASK_NAMES = [f"task-{index}" for index in range(10)]


def _trial(name: str, passed: bool, *, infra: bool = False, voided: bool = False, tokens: int = 100) -> dict:
    return {
        "name": name,
        "dataset": "terminal-bench-2-1",
        "passed": passed,
        "voided": voided,
        "infra": infra,
        "wall_sec": 60.0,
        "tokens": tokens,
        "findings": [],
        "cost_usd": 0.1,
        "cost_source": "agent-reported total_cost_usd",
        "known_cost_usd": 0.1,
    }


def _run(
    trials: list[dict],
    *,
    sha: str,
    index: int,
    arm: str = "base",
    model: str = MODEL,
    tasks: str = TASKS,
) -> dict:
    return {
        "arm": arm,
        "job_name": f"{arm}-{index}",
        "run_id": f"{arm}-{index}:{arm}",
        "model": model,
        "task_set_sha": tasks,
        "harness_sha": sha,
        "trials": trials,
    }



def base_runs(repeats: int = 5, **kwargs) -> list[dict]:
    outcomes = [
        [(task_index + repeat) % 5 < 2 for task_index in range(len(TASK_NAMES))]
        for repeat in range(repeats)
    ]
    return [
        _run(
            [_trial(name, outcomes[repeat][i]) for i, name in enumerate(TASK_NAMES)],
            sha=BASE_SHA,
            index=repeat,
            **kwargs,
        )
        for repeat in range(repeats)
    ]


def candidate_runs(passes: bool | None, repeats: int = 5, **kwargs) -> list[dict]:
    runs = []
    for repeat in range(repeats):
        if passes is None:
            trials = [_trial(name, False, tokens=0) for name in TASK_NAMES]
        else:
            trials = [_trial(name, passes) for name in TASK_NAMES]
        runs.append(_run(trials, sha=CAND_SHA, index=repeat, arm="candidate", **kwargs))
    return runs


def identical_candidate(repeats: int = 5) -> list[dict]:
    return [
        {**run, "harness_sha": CAND_SHA, "arm": "candidate", "run_id": f"cand-{i}:candidate"}
        for i, run in enumerate(base_runs(repeats))
    ]


def test_positive_control_a_known_better_harness_is_better_and_not_blocked() -> None:
    result = gate.judge(base_runs(), candidate_runs(True))
    assert result.verdict == "better"
    assert not result.blocked
    assert result.delta > result.mde > 0


def test_null_control_an_identical_harness_is_not_blocked() -> None:
    result = gate.judge(base_runs(), identical_candidate())
    assert result.verdict == "no-detectable-difference"
    assert result.delta == 0
    assert not result.blocked


def test_broken_control_a_candidate_whose_agent_never_runs_is_blocked() -> None:
    result = gate.judge(base_runs(), candidate_runs(None))
    assert result.verdict == "broken"
    assert result.blocked


def test_broken_control_when_every_candidate_trial_is_infrastructure() -> None:
    candidate = [
        _run([_trial(name, False, infra=True, tokens=0) for name in TASK_NAMES], sha=CAND_SHA, index=i, arm="candidate")
        for i in range(5)
    ]
    assert gate.judge(base_runs(), candidate).verdict == "broken"


def test_a_clearly_worse_harness_is_worse_and_blocked() -> None:
    result = gate.judge(base_runs(), candidate_runs(False))
    assert result.verdict == "worse"
    assert result.blocked


def test_a_difference_below_the_mde_is_neither_better_nor_worse() -> None:
    candidate = identical_candidate()
    flipped = candidate[0]["trials"][0]
    flipped["passed"] = not flipped["passed"]
    result = gate.judge(base_runs(), candidate)
    assert result.verdict == "no-detectable-difference"
    assert 0 < abs(result.delta) < result.mde
    assert not result.blocked


def test_fewer_than_five_base_repeats_is_insufficient_data_and_blocked() -> None:
    result = gate.judge(base_runs(4), candidate_runs(True))
    assert result.verdict == "insufficient-data"
    assert result.blocked
    assert result.mde is None


def test_too_few_paired_tasks_is_insufficient_data() -> None:
    few = TASK_NAMES[:3]
    base = [
        {**run, "trials": [t for t in run["trials"] if t["name"] in few]} for run in base_runs()
    ]
    candidate = [
        {**run, "trials": [t for t in run["trials"] if t["name"] in few]}
        for run in candidate_runs(True)
    ]
    assert gate.judge(base, candidate).verdict == "insufficient-data"


def test_infrastructure_failures_exclude_the_task_from_the_pair() -> None:
    candidate = candidate_runs(True)
    for run in candidate:
        run["trials"][0] = _trial(TASK_NAMES[0], False, infra=True, tokens=0)
    result = gate.judge(base_runs(), candidate)
    assert result.tasks_paired == len(TASK_NAMES) - 1
    assert result.tasks_excluded == [f"terminal-bench-2-1/{TASK_NAMES[0]}"]
    assert result.verdict == "better"


def test_infrastructure_failures_never_count_as_a_regression() -> None:
    candidate = identical_candidate()
    for run in candidate:
        run["trials"][0] = _trial(TASK_NAMES[0], False, infra=True, tokens=0)
    result = gate.judge(base_runs(), candidate)
    assert result.verdict == "no-detectable-difference"
    assert result.delta == 0


def test_a_voided_trial_stays_scored_as_zero() -> None:
    candidate = candidate_runs(True)
    for run in candidate:
        run["trials"] = [_trial(n, True, voided=True) for n in TASK_NAMES]
    assert gate.judge(base_runs(), candidate).verdict == "worse"


def test_mde_formula_matches_the_documented_value() -> None:
    result = gate.judge(base_runs(), candidate_runs(True))
    sample_variance = 0.3
    n_tasks = len(TASK_NAMES)
    standard_error = (n_tasks * sample_variance * (1 / 5 + 1 / 5)) ** 0.5 / n_tasks
    expected = (gate.Z_ALPHA + gate.Z_POWER) * standard_error
    assert result.mde == pytest.approx(expected)


def test_mde_has_a_floor_of_one_flipped_trial() -> None:
    base = [
        _run([_trial(name, True) for name in TASK_NAMES], sha=BASE_SHA, index=i) for i in range(5)
    ]
    candidate = [
        _run([_trial(name, True) for name in TASK_NAMES], sha=CAND_SHA, index=i, arm="candidate")
        for i in range(5)
    ]
    result = gate.judge(base, candidate)
    assert result.mde == pytest.approx(1 / (len(TASK_NAMES) * 5))


def test_a_model_mismatch_is_refused() -> None:
    with pytest.raises(gate.GateRefused, match="model"):
        gate.judge(base_runs(), candidate_runs(True, model="other-model"))


def test_a_task_set_mismatch_is_refused() -> None:
    with pytest.raises(gate.GateRefused, match="task set"):
        gate.judge(base_runs(), candidate_runs(True, tasks="d" * 64))


def test_missing_pins_are_refused() -> None:
    base = base_runs()
    del base[0]["model"]
    with pytest.raises(gate.GateRefused, match="model"):
        gate.judge(base, candidate_runs(True))


def test_mixed_models_within_an_arm_are_refused() -> None:
    base = base_runs()
    base[1]["model"] = "other-model"
    with pytest.raises(gate.GateRefused, match="model"):
        gate.judge(base, candidate_runs(True))


def test_mixed_harness_shas_within_the_base_arm_are_refused() -> None:
    base = base_runs()
    base[1]["harness_sha"] = "e" * 64
    with pytest.raises(gate.GateRefused, match="harness"):
        gate.judge(base, candidate_runs(True))


def test_an_empty_arm_is_refused() -> None:
    with pytest.raises(gate.GateRefused):
        gate.judge([], candidate_runs(True))


def test_results_pin_model_task_set_shas_repeats_mde_and_cost(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "spend.jsonl"))
    base, candidate = base_runs(), candidate_runs(True)
    for run in [*base, *candidate]:
        budget.reserve(run["run_id"], 5.0)
        budget.settle(run["run_id"], 1.5, "agent-reported total_cost_usd")
    results = gate.build_results(gate.judge(base, candidate), base, candidate)
    assert results["model"] == MODEL
    assert results["taskSetSha"] == TASKS
    assert results["harnessShaBase"] == BASE_SHA
    assert results["harnessShaCandidate"] == CAND_SHA
    assert results["repeats"] == {"base": 5, "candidate": 5}
    assert results["mde"] > 0
    assert results["verdict"] == "better"
    assert results["blocked"] is False
    assert results["costUsd"] == pytest.approx(15.0)
    assert results["unsettledRuns"] == []


def test_results_report_unsettled_runs_instead_of_guessing_cost(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "spend.jsonl"))
    base, candidate = base_runs(), candidate_runs(True)
    results = gate.build_results(gate.judge(base, candidate), base, candidate)
    assert results["costUsd"] is None
    assert len(results["unsettledRuns"]) == 10


def write_runs(directory: Path, runs: list[dict]) -> list[str]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, run in enumerate(runs):
        path = directory / f"{index}.json"
        path.write_text(json.dumps(run))
        paths.append(str(path))
    return paths


def test_cli_exit_codes_follow_the_verdict(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "spend.jsonl"))
    base = write_runs(tmp_path / "base", base_runs())
    better = write_runs(tmp_path / "better", candidate_runs(True))
    broken = write_runs(tmp_path / "broken", candidate_runs(None))
    out = tmp_path / "out.json"
    assert gate.main(["compare", "--base", *base, "--candidate", *better, "--out", str(out)]) == 0
    assert json.loads(out.read_text())["verdict"] == "better"
    assert gate.main(["compare", "--base", *base, "--candidate", *broken, "--out", str(out)]) == 1
    assert json.loads(out.read_text())["verdict"] == "broken"


def test_cli_refusal_exits_two_and_writes_a_refusal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "spend.jsonl"))
    base = write_runs(tmp_path / "base", base_runs())
    other = write_runs(tmp_path / "other", candidate_runs(True, model="other"))
    out = tmp_path / "out.json"
    assert gate.main(["compare", "--base", *base, "--candidate", *other, "--out", str(out)]) == 2
    assert json.loads(out.read_text())["verdict"] == "refused"


def test_cli_trigger_exits_zero_only_for_harness_diffs(tmp_path: Path) -> None:
    touching = tmp_path / "touching.txt"
    touching.write_text("README.md\napps/daemon/src/backend/pi.ts\n")
    untouching = tmp_path / "untouching.txt"
    untouching.write_text("README.md\n")
    assert gate.main(["trigger", "--files", str(touching)]) == 0
    assert gate.main(["trigger", "--files", str(untouching)]) == 1


def _ruler_tree(root: Path, executor: str = "e", gate_source: str = "g", workflow: str = "w") -> Path:
    gate_dir = root / "integration/eval/harbor/public/cairn_harbor"
    gate_dir.mkdir(parents=True)
    (gate_dir / "cairn_executor.py").write_text(executor)
    (gate_dir / "gate.py").write_text(gate_source)
    (root / ".github/workflows").mkdir(parents=True)
    (root / ".github/workflows/eval-gate.yml").write_text(workflow)
    return root


def _ruler_args(tmp_path: Path, changed: list[str], arms: list[Path]) -> list[str]:
    files = tmp_path / "changed.txt"
    files.write_text("\n".join(changed) + "\n")
    out = tmp_path / "ruler.json"
    args = ["ruler", "--files", str(files), "--ruler", str(tmp_path / "ruler"), "--out", str(out)]
    for arm in arms:
        args += ["--arm", str(arm)]
    return args


def test_ruler_check_proceeds_when_only_harness_paths_changed(tmp_path: Path) -> None:
    ruler = _ruler_tree(tmp_path / "ruler")
    arms = [_ruler_tree(tmp_path / "base"), _ruler_tree(tmp_path / "candidate", executor="changed")]
    args = _ruler_args(
        tmp_path, ["integration/eval/harbor/public/cairn_harbor/cairn_executor.py"], arms
    )
    assert ruler.exists()
    assert gate.main(args) == 0


def test_ruler_check_refuses_when_a_ruler_file_changed_in_the_diff(tmp_path: Path) -> None:
    _ruler_tree(tmp_path / "ruler")
    arms = [_ruler_tree(tmp_path / "base"), _ruler_tree(tmp_path / "candidate")]
    args = _ruler_args(tmp_path, ["integration/eval/harbor/public/cairn_harbor/gate.py"], arms)
    assert gate.main(args) == 2
    result = json.loads((tmp_path / "ruler.json").read_text())
    assert result["verdict"] == "refused"
    assert result["reason"].startswith("refused: ruler changed")


def test_ruler_check_refuses_when_the_workflow_changed_in_the_diff(tmp_path: Path) -> None:
    _ruler_tree(tmp_path / "ruler")
    arms = [_ruler_tree(tmp_path / "candidate")]
    args = _ruler_args(tmp_path, [".github/workflows/eval-gate.yml"], arms)
    assert gate.main(args) == 2


def test_ruler_check_refuses_when_an_arm_ruler_differs_from_the_default_branch(tmp_path: Path) -> None:
    _ruler_tree(tmp_path / "ruler")
    arms = [_ruler_tree(tmp_path / "base"), _ruler_tree(tmp_path / "candidate", gate_source="tampered")]
    args = _ruler_args(
        tmp_path, ["integration/eval/harbor/public/cairn_harbor/cairn_executor.py"], arms
    )
    assert gate.main(args) == 2
    assert "candidate" in json.loads((tmp_path / "ruler.json").read_text())["reason"]

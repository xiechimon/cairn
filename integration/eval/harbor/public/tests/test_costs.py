import json
from datetime import datetime, timezone
from pathlib import Path

from cairn_harbor.costs import StepUsage, read_step_usage, summarize_trial


def _write_trial(
    trial_dir: Path,
    *,
    result: dict | None,
    steps: list[dict] | None = None,
) -> None:
    trial_dir.mkdir(parents=True, exist_ok=True)
    if result is not None:
        (trial_dir / "result.json").write_text(
            json.dumps({**result, "step_results": steps or []})
        )
    for index, step in enumerate(steps or []):
        step_dir = trial_dir / f"step-{index}"
        step_dir.mkdir(parents=True, exist_ok=True)
        (step_dir / "result.json").write_text(json.dumps(step))


def _stamp(seconds: int) -> str:
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def test_read_step_usage_sums_input_and_output_tokens(tmp_path: Path) -> None:
    _write_trial(
        tmp_path,
        result={"started_at": _stamp(0)},
        steps=[
            {"agent_result": {"n_input_tokens": 100, "n_output_tokens": 20}},
            {"agent_result": {"n_input_tokens": 300, "n_output_tokens": 40}},
        ],
    )
    usage = read_step_usage(tmp_path)
    assert usage.input_tokens == 400
    assert usage.output_tokens == 60


def test_read_step_usage_ignores_missing_step_results(tmp_path: Path) -> None:
    _write_trial(tmp_path, result={"started_at": _stamp(0)}, steps=[])
    assert read_step_usage(tmp_path) == StepUsage(0, 0)


def test_wall_time_comes_from_step_timestamps(tmp_path: Path) -> None:
    _write_trial(
        tmp_path,
        result={"started_at": _stamp(0)},
        steps=[
            {
                "agent_execution": {
                    "started_at": _stamp(10),
                    "finished_at": _stamp(70),
                }
            },
            {
                "agent_execution": {
                    "started_at": _stamp(80),
                    "finished_at": _stamp(95),
                }
            },
        ],
    )
    trial = summarize_trial(tmp_path, name="trial-1", voided=False)
    assert trial.wall_sec == 75.0
    assert trial.infra is False


def test_infra_failure_comes_from_the_trial_exception(tmp_path: Path) -> None:
    _write_trial(
        tmp_path,
        result={
            "started_at": _stamp(0),
            "exception_info": {"exception_type": "EnvironmentStartTimeout"},
        },
    )
    trial = summarize_trial(tmp_path, name="trial-2", voided=False)
    assert trial.infra is True
    assert trial.passed is False


def test_missing_result_counts_as_infra_failure(tmp_path: Path) -> None:
    tmp_path.mkdir(parents=True, exist_ok=True)
    trial = summarize_trial(tmp_path, name="trial-3", voided=False)
    assert trial.infra is True


def test_passed_requires_a_positive_reward(tmp_path: Path) -> None:
    _write_trial(
        tmp_path,
        result={
            "started_at": _stamp(0),
            "verifier_result": {"rewards": {"reward": 1.0}},
        },
    )
    trial = summarize_trial(tmp_path, name="trial-4", voided=False)
    assert trial.passed is True


def test_voided_trial_is_neither_passed_nor_scored(tmp_path: Path) -> None:
    _write_trial(
        tmp_path,
        result={
            "started_at": _stamp(0),
            "verifier_result": {"rewards": {"reward": 1.0}},
        },
    )
    trial = summarize_trial(tmp_path, name="trial-5", voided=True)
    assert trial.passed is False
    assert trial.voided is True


def test_trial_name_drops_the_harbor_uuid_suffix(tmp_path: Path) -> None:
    _write_trial(tmp_path, result={"started_at": _stamp(0)})
    trial = summarize_trial(
        tmp_path, name="astropy__astropy-12907__NGBq4pV", voided=False
    )
    assert trial.name == "astropy__astropy-12907"


def test_trial_name_drops_the_harbor_attempt_suffix(tmp_path: Path) -> None:
    _write_trial(tmp_path, result={"started_at": _stamp(0)})
    trial = summarize_trial(tmp_path, name="task__abc123__attempt-2", voided=False)
    assert trial.name == "task__abc123"


def test_summarize_trial_keeps_the_dataset_label(tmp_path: Path) -> None:
    _write_trial(
        tmp_path,
        result={"started_at": _stamp(0)},
    )
    trial = summarize_trial(
        tmp_path,
        name="regex-log__deadbeef",
        voided=False,
        dataset="terminal-bench-2-1",
    )
    assert trial.dataset == "terminal-bench-2-1"
    assert trial.name == "regex-log"


def test_docker_peak_parse_handles_gib_and_mib() -> None:
    from cairn_harbor.costs import parse_docker_stats_peak

    assert parse_docker_stats_peak("1.5GiB / 2GiB") == 1536
    assert parse_docker_stats_peak("512MiB / 2GiB") == 512
    assert parse_docker_stats_peak("garbage") is None


def test_systemd_peak_memory_reads_control_group() -> None:
    from cairn_harbor.costs import parse_systemd_show

    assert parse_systemd_show("MemoryPeak=21474836480\n") == 20 * 1024**3
    assert parse_systemd_show("MemoryPeak=\n") is None


def test_repeated_identical_step_contexts_are_counted_once(tmp_path: Path) -> None:
    context = {"n_input_tokens": 100, "n_output_tokens": 20}
    _write_trial(
        tmp_path,
        result={"started_at": _stamp(0), "agent_result": context},
        steps=[{"agent_result": context}],
    )
    assert read_step_usage(tmp_path) == StepUsage(100, 20)


def test_step_dirs_are_read_when_the_trial_result_has_no_steps(tmp_path: Path) -> None:
    _write_trial(tmp_path, result={"started_at": _stamp(0)})
    step_dir = tmp_path / "step-0"
    step_dir.mkdir(parents=True)
    (step_dir / "result.json").write_text(
        json.dumps({"agent_result": {"n_input_tokens": 7, "n_output_tokens": 3}})
    )
    assert read_step_usage(tmp_path) == StepUsage(7, 3)


def test_auxiliary_reward_cannot_turn_a_failure_into_a_pass(tmp_path: Path) -> None:
    _write_trial(tmp_path, result={
        "verifier_result": {"rewards": {"reward": 0.0, "auxiliary": 1.0}}
    })
    assert not summarize_trial(tmp_path, name="task", voided=False).passed

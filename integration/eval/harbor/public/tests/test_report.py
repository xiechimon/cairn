import json
import math
from datetime import datetime, timezone
from pathlib import Path

from cairn_harbor.costs import TrialCost, summarize_trial
from cairn_harbor.report import (
    arm_summary,
    build_report,
    scan_summary,
    wilson_interval,
)
from cairn_harbor.scan import ScanFinding


def test_wilson_interval_for_full_pass_rate() -> None:
    lower, upper = wilson_interval(20, 20, z=1.96)
    assert math.isclose(lower, 0.8389, abs_tol=1e-3)
    assert math.isclose(upper, 1.0, abs_tol=1e-3)


def test_wilson_interval_for_zero_pass_rate() -> None:
    lower, upper = wilson_interval(0, 20, z=1.96)
    assert math.isclose(lower, 0.0, abs_tol=1e-3)
    assert math.isclose(upper, 0.1611, abs_tol=1e-3)


def test_wilson_interval_for_no_trials() -> None:
    assert wilson_interval(0, 0) == (0.0, 0.0)


def test_wilson_interval_for_7_of_20_matches_reference() -> None:
    lower, upper = wilson_interval(7, 20, z=1.96)
    assert math.isclose(lower, 0.1812, abs_tol=5e-4)
    assert math.isclose(upper, 0.5671, abs_tol=5e-4)


def _trial(name: str, passed: bool, infra: bool = False, voided: bool = False) -> TrialCost:
    return TrialCost(
        name=name,
        dataset="terminal-bench-2-1",
        passed=passed,
        voided=voided,
        infra=infra,
        wall_sec=100.0,
        tokens=10,
        findings=(),
    )


def test_arm_summary_counts_infra_failures_separately() -> None:
    outcomes = [
        _trial("t1", passed=True),
        _trial("t2", passed=False),
        _trial("t3", passed=False, infra=True),
    ]
    summary = arm_summary(outcomes, label="A")
    assert summary.total == 3
    assert summary.scored == 2
    assert summary.passed == 1
    assert summary.infra_failures == 1
    assert summary.voided == 0
    assert summary.pass_rate == 0.5


def test_arm_summary_excludes_voided_trials_from_the_denominator() -> None:
    outcomes = [
        _trial("t1", passed=True),
        _trial("t2", passed=False, voided=True),
    ]
    summary = arm_summary(outcomes, label="B")
    assert summary.scored == 1
    assert summary.voided == 1
    assert summary.pass_rate == 1.0


def _write_trial_dir(
    root: Path, name: str, reward: float | None, exception: bool = False
) -> Path:
    trial_dir = root / name
    trial_dir.mkdir(parents=True)
    result: dict = {"started_at": datetime.now(timezone.utc).isoformat()}
    if reward is not None:
        result["verifier_result"] = {"rewards": {"reward": reward}}
    if exception:
        result["exception_info"] = {
            "exception_type": "EnvironmentStartTimeout",
            "exception_message": "boom",
            "exception_traceback": "",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
    (trial_dir / "result.json").write_text(json.dumps(result))
    return trial_dir


def test_summarize_trial_voids_a_trial_that_edited_a_test_file(tmp_path: Path) -> None:
    trial_dir = _write_trial_dir(tmp_path, "static-web-server__abc123", reward=1.0)
    agent_dir = trial_dir / "agent"
    agent_dir.mkdir()
    (agent_dir / "pi.txt").write_text(
        json.dumps(
            {
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "toolCall",
                            "id": "c1",
                            "name": "edit",
                            "arguments": {
                                "filePath": "/app/tests/test_outputs.py",
                                "oldText": "a",
                                "newText": "b",
                            },
                        }
                    ],
                }
            }
        )
        + "\n"
    )
    trial = summarize_trial(
        trial_dir, name=trial_dir.name, voided=True, dataset="terminal-bench-2-1"
    )
    assert ScanFinding.EDIT_TEST_FILE in trial.findings
    assert trial.voided is True
    assert trial.passed is False


def test_scan_summary_lists_every_finding_kind(tmp_path: Path) -> None:
    summary = scan_summary([_trial("t1", passed=True)])
    assert summary[ScanFinding.EDIT_TEST_FILE.value] == 0
    assert summary[ScanFinding.BENCHMARK_SITE_ACCESS.value] == 0
    assert summary[ScanFinding.HARNESS_SESSION_EDIT.value] == 0


def test_build_report_contains_sections() -> None:
    report = build_report(
        arms={"pi": arm_summary([_trial("t1", passed=True)], label="pi")},
        task_names=["t1"],
        seed=1,
        model="reflection/beam:free",
    )
    assert "pi" in report
    assert "t1" in report
    assert "reflection/beam:free" in report
    assert "voided" in report.lower()
    assert "infra" in report.lower()


def test_partial_report_separates_planned_tasks_and_collected_trials() -> None:
    report = build_report(
        arms={"A": arm_summary([_trial("t1", True)], "A")},
        task_names=["t1", "t2"], seed=1792, model="free",
    )
    assert "Planned tasks: 2" in report
    assert "Collected trials: 1" in report
    assert "20 SWE-bench" not in report
    assert "t2" in report

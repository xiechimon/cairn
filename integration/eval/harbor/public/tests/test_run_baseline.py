import json
from pathlib import Path

from cairn_harbor.run_baseline import (
    collect_outcomes,
    systemd_wrap_command,
    agent_config,
    job_config,
)


def test_systemd_wrap_command_waits_and_pipes_the_unit() -> None:
    wrapped = systemd_wrap_command(
        ["harbor", "run"], unit_name="cairn-harbor-1", memory_max="20G", env={}
    )
    assert wrapped[:4] == ["systemd-run", "--user", "--unit", "cairn-harbor-1"]
    assert "--wait" in wrapped
    assert "--pipe" in wrapped
    assert wrapped[-3:] == ["--", "harbor", "run"]
    assert "-p" in wrapped
    assert wrapped[wrapped.index("-p") + 1] == "MemoryMax=20G"


def test_systemd_wrap_command_forwards_the_model_key() -> None:
    wrapped = systemd_wrap_command(
        ["harbor", "run"],
        unit_name="cairn-harbor-2",
        memory_max="20G",
        env={"OPENAI_API_KEY": "sk-test"},
    )
    setenv_at = wrapped.index("--setenv")
    assert wrapped[setenv_at + 1] == "OPENAI_API_KEY=sk-test"


def test_agent_config_for_oracle_runs_without_a_model() -> None:
    config = agent_config("oracle")
    assert config["name"] == "oracle"
    assert "model_name" not in config


def test_agent_config_for_pi() -> None:
    config = agent_config("pi")
    assert config["name"] == "pi"
    assert config["model_name"] == "reflection/beam:free"
    assert config["base_url"].startswith("https://api.commandcode.ai")


def test_agent_config_for_cairn_ships_skill_dir() -> None:
    config = agent_config("cairn")
    assert config["import_path"].endswith("CairnExecutor")
    assert any("skills" in value for value in config.get("skills", []))


def test_job_config_maps_task_names_to_paths(tmp_path: Path) -> None:
    swe = tmp_path / "swebench-verified"
    tb = tmp_path / "terminal-bench-2-1"
    (swe / "astropy__astropy-12907").mkdir(parents=True)
    (tb / "adaptive-rejection-sampler").mkdir(parents=True)
    payload = {
        "swebench-verified": ["astropy__astropy-12907"],
        "terminal-bench-2-1": ["adaptive-rejection-sampler"],
    }
    config = job_config(
        payload,
        datasets_dir=tmp_path,
        arm="pi",
        job_name="baseline-A",
    )
    assert config["job_name"] == "baseline-A"
    assert config["n_attempts"] == 1
    paths = {task["path"] for task in config["tasks"]}
    assert str(swe / "astropy__astropy-12907") in paths
    assert str(tb / "adaptive-rejection-sampler") in paths


def test_read_subset_seed_reads_the_subset_file(tmp_path: Path) -> None:
    subset = tmp_path / "subset-1792.json"
    subset.write_text('{"seed": 1792}')
    from cairn_harbor.run_baseline import read_subset_seed

    assert read_subset_seed(subset) == 1792


def test_read_subset_seed_requires_metadata(tmp_path: Path) -> None:
    import pytest
    from cairn_harbor.run_baseline import read_subset_seed

    with pytest.raises(ValueError, match="seed"):
        read_subset_seed(None)
    empty = tmp_path / "empty.json"
    empty.write_text("{}")
    with pytest.raises(ValueError, match="seed"):
        read_subset_seed(empty)


def test_job_config_rejects_unknown_arm(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(ValueError):
        job_config({"swebench-verified": []}, tmp_path, "bogus", "job")


def test_job_config_rejects_a_missing_task_directory(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(FileNotFoundError):
        job_config({"swebench-verified": ["ghost"]}, tmp_path, "pi", "job")


def test_cairn_arm_uses_the_same_model_and_channel_as_pi() -> None:
    pi = agent_config("pi")
    cairn = agent_config("cairn")
    for key in ("model_name", "base_url", "model_api_key_name", "kwargs"):
        assert cairn[key] == pi[key]
    assert "relay-186" not in json.dumps(cairn).lower()


def test_collect_outcomes_keeps_normal_source_edits_valid(tmp_path: Path) -> None:
    trial = tmp_path / "job" / "solver__attempt1"
    (trial / "agent").mkdir(parents=True)
    (trial / "result.json").write_text(json.dumps({
        "verifier_result": {"rewards": {"reward": 1.0}}
    }))
    (trial / "agent" / "pi.txt").write_text(json.dumps({
        "message": {"role": "assistant", "content": [{
            "type": "toolCall", "name": "edit", "arguments": {
                "path": "/app/solver.py", "newText": "return 1"
            }
        }]}
    }))
    outcomes = collect_outcomes(tmp_path, "job", "A")
    assert len(outcomes) == 1
    assert not outcomes[0].voided
    assert outcomes[0].passed


def test_collect_outcomes_scans_declared_harness_sessions(tmp_path: Path) -> None:
    from cairn_harbor.scan import ScanFinding

    trial = tmp_path / "job" / "solver__attempt1"
    trial.mkdir(parents=True)
    (trial / "result.json").write_text(json.dumps({
        "verifier_result": {"rewards": {"reward": 1.0}}
    }))
    session = trial / "cloned.jsonl"
    session.write_text(json.dumps({"message": {"role": "assistant", "content": [{
        "type": "toolCall", "name": "edit", "arguments": {"path": "/app/solver.py"}
    }]}}))
    outcomes = collect_outcomes(tmp_path, "job", "A",
        harness_sessions={trial.name: [session]})
    assert outcomes[0].voided
    assert not outcomes[0].passed
    assert ScanFinding.HARNESS_SESSION_EDIT in outcomes[0].findings

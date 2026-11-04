import json
from pathlib import Path

import pytest

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


def test_free_and_oracle_runs_are_not_metered() -> None:
    from cairn_harbor.run_baseline import is_metered

    assert is_metered(None) is False
    assert is_metered("reflection/beam:free") is False
    assert is_metered("claude-test") is True


def test_config_model_reads_the_first_agent(tmp_path: Path) -> None:
    from cairn_harbor.run_baseline import config_model

    path = tmp_path / "job.json"
    path.write_text(json.dumps({"agents": [{"model_name": "claude-test"}]}))
    assert config_model(path) == "claude-test"
    path.write_text(json.dumps({"agents": [{"name": "oracle"}]}))
    assert config_model(path) is None


def test_config_job_name_reads_the_configured_name(tmp_path: Path) -> None:
    from cairn_harbor.run_baseline import config_job_name

    path = tmp_path / "job.json"
    path.write_text(json.dumps({"job_name": "b-1", "agents": []}))
    assert config_job_name(path) == "b-1"
    path.write_text(json.dumps({"agents": []}))
    assert config_job_name(path) is None


def test_run_refuses_a_job_name_that_differs_from_the_config(
    tmp_path: Path, monkeypatch
) -> None:
    from cairn_harbor import run_baseline

    config = tmp_path / "job.json"
    config.write_text(json.dumps({"job_name": "real", "agents": [{"model_name": "claude-test"}]}))
    tasks = tmp_path / "tasks.json"
    tasks.write_text(
        json.dumps(
            {
                "seed": 1,
                run_baseline.SWE_DATASET_DIR_NAME: [],
                run_baseline.TB_DATASET_DIR_NAME: [],
            }
        )
    )
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "spend.jsonl"))
    started = []
    monkeypatch.setattr(run_baseline, "run_job", lambda *a, **k: started.append(a))
    monkeypatch.setattr(
        "sys.argv",
        [
            "run_baseline", "run", "--config", str(config), "--arm-label", "B",
            "--jobs-dir", str(tmp_path / "jobs"), "--job-name", "other",
            "--tasks", str(tasks), "--max-run-usd", "1", "--out-dir", str(tmp_path / "out"),
        ],
    )
    with pytest.raises(SystemExit):
        run_baseline.main()
    assert started == []
    assert not (tmp_path / "spend.jsonl").exists()


def test_task_set_sha_pins_the_exact_bytes_of_the_tasks_file(tmp_path: Path) -> None:
    import hashlib

    from cairn_harbor.run_baseline import task_set_sha

    tasks = tmp_path / "tasks.json"
    tasks.write_text('{"seed": 1}')
    assert task_set_sha(tasks) == hashlib.sha256(b'{"seed": 1}').hexdigest()
    tasks.write_text('{"seed": 2}')
    assert task_set_sha(tasks) != hashlib.sha256(b'{"seed": 1}').hexdigest()

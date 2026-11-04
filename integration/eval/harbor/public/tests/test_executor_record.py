import asyncio
import json
import subprocess
from pathlib import Path

import pytest

from cairn_harbor.cairn_executor import CairnExecutor
from cairn_harbor.constants import read_worker_system_prompt
from cairn_harbor.executor_record import (
    RECORD_FILE_NAME,
    RECORD_KEYS,
    build_executor_record,
)
from cairn_harbor.run_baseline import collect_executor_records
from tests.test_cairn_executor import RecordingEnvironment

VECTORS = json.loads(
    (Path(__file__).resolve().parent.parent / "parity-vectors.json").read_text()
)["vectors"]


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_record_matches_the_shared_vector(vector) -> None:
    given = vector["input"]
    record = build_executor_record(
        given["backend"],
        given["model"],
        given["effort"],
        given["systemPrompt"],
        given["skills"],
        given["tools"],
    )
    assert record.to_json() == vector["record"]


def test_record_has_exactly_the_four_parity_fields() -> None:
    record = build_executor_record("pi", "p/m", None, "", [], [])
    assert tuple(sorted(record.to_json())) == tuple(sorted(RECORD_KEYS))


@pytest.mark.parametrize("effort", [None, ""])
def test_unset_effort_is_recorded_as_null(effort) -> None:
    assert build_executor_record("pi", "p/m", effort, "", [], []).effort is None


def test_discovery_order_does_not_change_the_hash() -> None:
    skills = [{"name": "b", "content": "1"}, {"name": "A", "content": "2"}]
    forward = build_executor_record("pi", "p/m", None, "x", skills, [])
    backward = build_executor_record("pi", "p/m", None, "x", skills[::-1], [])
    assert forward.harness_sha == backward.harness_sha


@pytest.mark.parametrize(
    "change",
    [
        dict(system_prompt="y"),
        dict(skills=[{"name": "s", "content": "changed"}]),
        dict(tools=[{"name": "t", "description": "d"}]),
    ],
)
def test_any_harness_component_changes_the_hash(change) -> None:
    base = dict(system_prompt="x", skills=[{"name": "s", "content": "c"}], tools=[])
    original = build_executor_record("pi", "p/m", None, **base)
    changed = build_executor_record("pi", "p/m", None, **{**base, **change})
    assert changed.harness_sha != original.harness_sha


def _install(tmp_path: Path, **kwargs) -> dict:
    executor = CairnExecutor(
        logs_dir=tmp_path, model_name="reflection/beam:free", **kwargs
    )
    asyncio.run(executor.install(RecordingEnvironment()))
    return json.loads((tmp_path / RECORD_FILE_NAME).read_text())


def test_executor_records_what_it_uploads(tmp_path) -> None:
    recorded = _install(tmp_path)
    expected = build_executor_record(
        "pi",
        "reflection/beam:free",
        None,
        read_worker_system_prompt(),
        [],
        [],
    )
    assert recorded == expected.to_json()


def test_executor_record_follows_the_prompt_source(tmp_path, monkeypatch) -> None:
    before = _install(tmp_path)
    monkeypatch.setattr(
        "cairn_harbor.cairn_executor.read_worker_system_prompt", lambda: "changed"
    )
    after = _install(tmp_path)
    assert before["harness_sha"] != after["harness_sha"]


def test_executor_record_carries_the_effort(tmp_path) -> None:
    assert _install(tmp_path, reasoning_effort="high")["effort"] == "high"


def test_collect_reads_one_record_per_trial_and_flags_a_missing_one(tmp_path) -> None:
    job = tmp_path / "job"
    (job / "t1" / "agent").mkdir(parents=True)
    (job / "t2" / "agent").mkdir(parents=True)
    record = build_executor_record("pi", "p/m", None, "x", [], []).to_json()
    (job / "t1" / "agent" / RECORD_FILE_NAME).write_text(json.dumps(record))
    assert collect_executor_records(tmp_path, "job") == {"t1": record, "t2": None}


def test_executor_without_injected_skills_records_an_empty_set(tmp_path) -> None:
    recorded = _install(tmp_path)
    assert recorded == build_executor_record(
        "pi", "reflection/beam:free", None, read_worker_system_prompt(), [], []
    ).to_json()


def test_executor_hashes_the_skills_uploaded_to_the_environment(tmp_path) -> None:
    class SkillsEnvironment(RecordingEnvironment):
        async def exec(self, **kwargs):
            result = await super().exec(**kwargs)
            if "node -e" in kwargs.get("command", ""):
                result.stdout = json.dumps(self.skills)
            return result

    environment = SkillsEnvironment()
    environment.skills = [{"name": "custom", "content": "custom instructions"}]
    executor = CairnExecutor(
        logs_dir=tmp_path, model_name="reflection/beam:free", skills_dir="/runtime/custom"
    )
    asyncio.run(executor.install(environment))
    recorded = json.loads((tmp_path / RECORD_FILE_NAME).read_text())
    assert recorded == build_executor_record(
        "pi", "reflection/beam:free", None, read_worker_system_prompt(), environment.skills, []
    ).to_json()
    assert any("/runtime/custom" in command for command in environment.executed)
    environment.skills[0]["content"] = "updated instructions"
    asyncio.run(executor.install(environment))
    updated = json.loads((tmp_path / RECORD_FILE_NAME).read_text())
    assert updated["harness_sha"] != recorded["harness_sha"]


def test_executor_reads_skill_content_with_the_container_command(tmp_path) -> None:
    skills = tmp_path / "skills with spaces" / "custom"
    skills.mkdir(parents=True)
    (skills / "SKILL.md").write_text("runtime skill")

    class LocalSkillsEnvironment(RecordingEnvironment):
        async def exec(self, **kwargs):
            result = await super().exec(**kwargs)
            if "node -e" in kwargs.get("command", ""):
                process = subprocess.run(
                    kwargs["command"], shell=True, capture_output=True, text=True
                )
                result.stdout = process.stdout
                result.return_code = process.returncode
            return result

    executor = CairnExecutor(
        logs_dir=tmp_path, model_name="p/m", skills_dir=str(skills.parent)
    )
    asyncio.run(executor.install(LocalSkillsEnvironment()))
    recorded = json.loads((tmp_path / RECORD_FILE_NAME).read_text())
    assert recorded == build_executor_record(
        "pi", "p/m", None, read_worker_system_prompt(),
        [{"name": "custom", "content": "runtime skill"}], [],
    ).to_json()


def test_executor_refuses_an_unreadable_injected_skill_directory(tmp_path) -> None:
    class UnreadableSkillsEnvironment(RecordingEnvironment):
        async def exec(self, **kwargs):
            result = await super().exec(**kwargs)
            if "node -e" in kwargs.get("command", ""):
                result.return_code = 1
            return result

    executor = CairnExecutor(logs_dir=tmp_path, model_name="p/m", skills_dir="/missing")
    with pytest.raises(RuntimeError):
        asyncio.run(executor.install(UnreadableSkillsEnvironment()))
    assert not (tmp_path / RECORD_FILE_NAME).exists()

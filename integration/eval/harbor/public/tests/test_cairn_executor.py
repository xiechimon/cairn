import asyncio
import shlex
from pathlib import Path, PurePosixPath

import pytest

import cairn_harbor.cairn_executor
from cairn_harbor.cairn_executor import CairnExecutor
from cairn_harbor.constants import read_worker_system_prompt
from cairn_harbor.scan import ScanFinding, scan_session_text
from cairn_harbor.session import ingest_session_file_edit, touches_test_file

PROMPT_FILE = Path(cairn_harbor.cairn_executor.__file__).with_name(
    "cairn-worker-prompt.md"
)


class RecordingEnvironment:
    default_user = "agent"

    def __init__(self) -> None:
        self.executed: list[str] = []
        self.uploaded: list[tuple[str, str, str]] = []
        self.fail_exec = False

    async def exec(self, **kwargs):
        command = kwargs.get("command", "")
        self.executed.append(command)
        return type(
            "Result",
            (),
            {
                "return_code": 1 if self.fail_exec else 0,
                "stdout": "",
                "stderr": "boom" if self.fail_exec else "",
            },
        )()

    async def upload_file(self, local_path, remote_path):
        self.uploaded.append(
            (str(local_path), str(remote_path), Path(local_path).read_text())
        )


def _make_executor(tmp_path: Path) -> CairnExecutor:
    return CairnExecutor(logs_dir=tmp_path, model_name="reflection/beam:free")


def test_cairn_executor_name() -> None:
    assert CairnExecutor.name() == "cairn"


def test_cairn_executor_prompt_flag_points_at_config_file(tmp_path) -> None:
    executor = _make_executor(tmp_path)
    flags = shlex.split(executor.build_cli_flags())
    assert "--append-system-prompt" in flags
    assert flags[flags.index("--append-system-prompt") + 1] == (
        "/tmp/harbor-pi-agent/cairn-worker-prompt.txt"
    )


def test_cairn_executor_rejects_an_instruction_without_a_worker_prompt_upload(
    tmp_path,
) -> None:
    executor = _make_executor(tmp_path)
    environment = RecordingEnvironment()
    environment.fail_exec = True
    with pytest.raises(RuntimeError):
        asyncio.run(executor.install(environment))
    assert not any("cairn-worker-prompt.txt" in remote for _, remote, _ in environment.uploaded)


def test_worker_prompt_lives_in_a_repo_file() -> None:
    assert PROMPT_FILE.is_file()


def test_worker_system_prompt_is_read_from_the_repo_file_at_run_time() -> None:
    assert PROMPT_FILE.is_file()
    assert read_worker_system_prompt() == PROMPT_FILE.read_text().rstrip("\n")


def test_worker_system_prompt_is_english_and_mentions_worker_loop() -> None:
    prompt = read_worker_system_prompt()
    assert "worker" in prompt.lower()
    assert "plan" in prompt.lower()
    assert "self-review" in prompt.lower()


def test_worker_guidance_does_not_disclose_scan_rules() -> None:
    skill = PROMPT_FILE.parent.parent / "skills/cairn-worker/SKILL.md"
    for text in (read_worker_system_prompt(), skill.read_text()):
        for rule in ("conftest.py", "test_*.py", "leaderboard", "Do not fetch"):
            assert rule not in text


def test_install_writes_prompt_into_config_dir(tmp_path) -> None:
    environment = RecordingEnvironment()
    asyncio.run(_make_executor(tmp_path).install(environment))
    prompt_uploads = [
        (remote, content)
        for _, remote, content in environment.uploaded
        if PurePosixPath(remote).name == "cairn-worker-prompt.txt"
    ]
    assert prompt_uploads
    for remote, content in prompt_uploads:
        assert PurePosixPath(remote) == PurePosixPath(
            "/tmp/harbor-pi-agent/cairn-worker-prompt.txt"
        )
        assert content == read_worker_system_prompt()


def test_ingest_session_file_edit_names_the_path(tmp_path) -> None:
    session = tmp_path / "pi.txt"
    session.write_text(
        '{"message": {"role": "assistant", "content": [{"type": "toolCall", '
        '"id": "c1", "name": "edit", "arguments": {"filePath": "/app/src/x.py"}}]}}\n'
    )
    assert ingest_session_file_edit(session) == "/app/src/x.py"


def test_ingest_session_file_edit_returns_none_without_a_file_edit(tmp_path) -> None:
    session = tmp_path / "pi.txt"
    session.write_text(
        '{"message": {"role": "assistant", "content": [{"type": "toolCall", '
        '"id": "c1", "name": "bash", "arguments": {"command": "ls"}}]}}\n'
    )
    assert ingest_session_file_edit(session) is None


def test_ingest_session_file_edit_returns_none_for_a_missing_file(tmp_path) -> None:
    assert ingest_session_file_edit(tmp_path / "absent.txt") is None


def test_touches_test_file_true_for_a_test_edit(tmp_path) -> None:
    session = tmp_path / "pi.txt"
    session.write_text(
        '{"message": {"role": "assistant", "content": [{"type": "toolCall", '
        '"id": "c1", "name": "write", "arguments": {"filePath": "/app/tests/conftest.py", '
        '"content": "x"}}]}}\n'
    )
    assert touches_test_file(session) is True
    assert ScanFinding.EDIT_TEST_FILE in scan_session_text(
        session.read_text(encoding="utf-8")
    )


def test_touches_test_file_false_for_a_source_edit(tmp_path) -> None:
    session = tmp_path / "pi.txt"
    session.write_text(
        '{"message": {"role": "assistant", "content": [{"type": "toolCall", '
        '"id": "c1", "name": "edit", "arguments": {"filePath": "/app/src/x.py", '
        '"oldText": "a", "newText": "b"}}]}}\n'
    )
    assert touches_test_file(session) is False

import json
from pathlib import Path

from cairn_harbor.constants import TEST_FILE_PATTERNS
from cairn_harbor.scan import ScanFinding, scan_trial_dir


def _write_trial(agent_dir: Path, events: list[dict]) -> None:
    session_dir = agent_dir / "pi" / "sessions"
    session_dir.mkdir(parents=True)
    (agent_dir / "pi.txt").write_text(
        "\n".join(json.dumps(event) for event in events)
    )
    (session_dir / "session.jsonl").write_text(
        "\n".join(json.dumps(event) for event in events)
    )


def _tool_event(name: str, arguments: dict) -> dict:
    return {
        "type": "message",
        "message": {
            "role": "assistant",
            "content": [
                {"type": "toolCall", "id": "call-1", "name": name, "arguments": arguments}
            ],
        },
    }


def test_edit_to_test_file_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "edit",
                {"filePath": "/app/tests/test_outputs.py", "content": "assert True"},
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.EDIT_TEST_FILE in findings


def test_write_to_conftest_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [_tool_event("write", {"filePath": "/app/tests/conftest.py", "content": "x"})],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.EDIT_TEST_FILE in findings


def test_write_to_swebench_test_patch_target_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "write",
                {"filePath": "/testbed/tests/migrations/test_autodetector.py", "content": "x"},
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.EDIT_TEST_FILE in findings


def test_edit_to_any_test_tree_module_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "edit",
                {
                    "filePath": "/app/sklearn/tests/test_common.py",
                    "oldText": "assert y",
                    "newText": "assert True",
                },
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.EDIT_TEST_FILE in findings


def test_read_of_test_file_is_not_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "toolCall",
                            "id": "call-1",
                            "name": "read",
                            "arguments": {"filePath": "/app/tests/test_outputs.py"},
                        }
                    ],
                },
            }
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert all(
        finding != ScanFinding.EDIT_TEST_FILE for finding in findings
    )


def test_running_tests_from_the_shell_is_not_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "bash",
                {
                    "command": "cd /testbed && python -m pytest tests/migrations/test_autodetector.py -q",
                    "timeout": 120,
                },
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert findings == []


def test_curl_to_benchmark_site_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "bash",
                {
                    "command": "curl -s https://www.t-bench.org/leaderboard | head",
                    "timeout": 10,
                },
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.BENCHMARK_SITE_ACCESS in findings


def test_curl_to_tbench_ai_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "bash",
                {
                    "command": "curl -s https://tbench.ai/leaderboard > board.html",
                    "timeout": 10,
                },
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.BENCHMARK_SITE_ACCESS in findings


def test_cloning_a_benchmark_repo_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "bash",
                {
                    "command": (
                        "git clone https://github.com/SWE-bench/SWE-bench.git /tmp/upstream"
                    ),
                },
            )
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert ScanFinding.BENCHMARK_SITE_ACCESS in findings


def test_ingest_of_a_cloned_harness_session_is_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event(
                "edit",
                {"filePath": "/app/tests/conftest.py", "content": "x"},
            ),
            _tool_event(
                "edit",
                {"filePath": "/app/src/main.py", "content": "y"},
            ),
        ],
    )
    findings = scan_trial_dir(tmp_path, harness_session_paths=[agent_dir / "pi.txt"])
    assert ScanFinding.HARNESS_SESSION_EDIT in findings


def test_plain_code_edits_are_not_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            _tool_event("edit", {"filePath": "/app/src/solver.py", "content": "fix"}),
            _tool_event("bash", {"command": "pytest src", "timeout": 30}),
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert findings == []


def test_site_mention_in_reasoning_is_not_flagged(tmp_path: Path) -> None:
    agent_dir = tmp_path / "agent"
    _write_trial(
        agent_dir,
        [
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "text",
                            "text": "the terminal-bench leaderboard rule says -k 5",
                        }
                    ],
                },
            }
        ],
    )
    findings = scan_trial_dir(tmp_path)
    assert all(
        finding != ScanFinding.BENCHMARK_SITE_ACCESS for finding in findings
    )


def test_every_covered_test_pattern_has_a_case() -> None:
    covered = {"conftest.py", "test.sh", "test_outputs.py"}
    assert covered.issubset(set(TEST_FILE_PATTERNS))


def test_write_to_go_test_is_flagged(tmp_path: Path) -> None:
    _write_trial(tmp_path / "agent", [
        _tool_event("write", {"path": "/app/solver_test.go", "content": "package main"})
    ])
    assert ScanFinding.EDIT_TEST_FILE in scan_trial_dir(tmp_path)


def test_write_to_python_suffix_test_is_flagged(tmp_path: Path) -> None:
    _write_trial(tmp_path / "agent", [
        _tool_event("edit", {"path": "/app/solver_test.py", "newText": "pass"})
    ])
    assert ScanFinding.EDIT_TEST_FILE in scan_trial_dir(tmp_path)


def test_benchmark_url_boundaries() -> None:
    from cairn_harbor.scan import is_benchmark_site_target

    for url in (
        "https://bench.tbench.ai.evil.com/x",
        "https://example.com/tbench.ai",
        "https://github.com/swe-benchmarks/project",
        "https://example.com/?next=https://tbench.ai",
    ):
        assert not is_benchmark_site_target(url), url
    for url in ("https://bench.tbench.ai/x", "https://github.com/SWE-bench/SWE-bench.git"):
        assert is_benchmark_site_target(url), url

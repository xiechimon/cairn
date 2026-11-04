import importlib.util
import json
from pathlib import Path

import pytest


SPEC = importlib.util.spec_from_file_location(
    "label_task", Path(__file__).with_name("label-task.py")
)
labeler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(labeler)


@pytest.fixture
def task(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "solution").mkdir()
    (tmp_path / "instruction.md").write_text("# Issue 7\n\nMake add() sum.\n")
    (tmp_path / "tests/tests.patch").write_text("+assert add(2, 3) == 5\n")
    (tmp_path / "tests/test.sh").write_text("#!/bin/sh\npytest\n")
    (tmp_path / "solution/solution.patch").write_text("+SECRET_SOLUTION_MARKER\n")
    (tmp_path / "solution/solve.sh").write_text("SECRET_SOLVE_MARKER\n")
    (tmp_path / "provenance.json").write_text('{"title": "SECRET_TITLE_MARKER"}')
    return tmp_path


def test_prompt_contains_instruction_and_test_patch_only(task):
    prompt = labeler.build_prompt(task)
    assert "Make add() sum." in prompt
    assert "assert add(2, 3) == 5" in prompt
    assert "two experts would agree" in prompt
    for marker in ("SECRET_SOLUTION_MARKER", "SECRET_SOLVE_MARKER", "SECRET_TITLE_MARKER"):
        assert marker not in prompt


@pytest.mark.parametrize(
    "model", ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6", "minimax-m3", "deepseek-v4-flash"]
)
def test_banned_models_are_refused(model):
    with pytest.raises(ValueError, match="banned"):
        labeler.require_allowed_model(model)


def test_allowed_model_passes():
    labeler.require_allowed_model("gpt-6.1-sol")


def test_command_is_direct_codex_exec_never_ai_route():
    command = labeler.codex_command("gpt-6.1-sol", Path("/tmp/out.txt"), Path("/tmp/work"), "PROMPT")
    assert command[:2] == ["codex", "exec"]
    assert command[-1] == "PROMPT"
    assert "ai-route" not in " ".join(command)
    assert command[command.index("--sandbox") + 1] == "read-only"
    assert command[command.index("-m") + 1] == "gpt-6.1-sol"


def test_parse_label_takes_last_json_object_and_stamps_metadata():
    raw = 'thinking {"verdict": "reject"}\nfinal:\n{"verdict": "accept", "reason": "Tests assert the sum."}\n'
    label = labeler.parse_label(raw, "gpt-6.1-sol", "abc123", "2026-11-04T00:00:00Z")
    assert label == {
        "vendor": "openai",
        "model": "gpt-6.1-sol",
        "verdict": "accept",
        "reason": "Tests assert the sum.",
        "labeledAt": "2026-11-04T00:00:00Z",
        "promptSha256": "abc123",
        "route": "direct-codex-exec",
    }


@pytest.mark.parametrize(
    "raw",
    [
        "no json at all",
        '{"verdict": "maybe", "reason": "x"}',
        '{"verdict": "accept"}',
        '{"verdict": "accept", "reason": ""}',
    ],
)
def test_parse_label_rejects_malformed_output(raw):
    with pytest.raises(ValueError):
        labeler.parse_label(raw, "gpt-6.1-sol", "abc", "2026-11-04T00:00:00Z")


def test_prompt_digest_is_stable(task):
    assert labeler.prompt_digest(labeler.build_prompt(task)) == labeler.prompt_digest(
        labeler.build_prompt(task)
    )

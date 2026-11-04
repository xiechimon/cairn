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
    assert "testValidity" in prompt
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


def graded(under=0, valid=0, under_reason="Clear.", valid_reason="Fine."):
    return json.dumps(
        {
            "underspecification": under,
            "underspecificationReason": under_reason,
            "testValidity": valid,
            "testValidityReason": valid_reason,
        }
    )


def parse(raw):
    return labeler.parse_label(raw, "gpt-6.1-sol", "abc123", "2026-11-04T00:00:00Z")


def test_parse_label_takes_last_json_object_and_stamps_metadata():
    raw = 'thinking {"underspecification": 3}\nfinal:\n' + graded(1, 0, "Some blanks.", "Fine.")
    assert parse(raw) == {
        "vendor": "openai",
        "model": "gpt-6.1-sol",
        "rubric": "graded-v1",
        "underspecification": 1,
        "underspecificationReason": "Some blanks.",
        "testValidity": 0,
        "testValidityReason": "Fine.",
        "verdict": "accept",
        "labeledAt": "2026-11-04T00:00:00Z",
        "promptSha256": "abc123",
        "route": "direct-codex-exec",
    }


@pytest.mark.parametrize(
    "under,valid,verdict",
    [(0, 0, "accept"), (1, 1, "accept"), (2, 0, "reject"), (0, 2, "reject"), (3, 3, "reject"), (1, 3, "reject")],
)
def test_verdict_is_computed_from_the_scores(under, valid, verdict):
    assert parse(graded(under, valid))["verdict"] == verdict


def test_model_supplied_verdict_is_ignored():
    raw = json.dumps(
        {
            "verdict": "accept",
            "underspecification": 3,
            "underspecificationReason": "Vague.",
            "testValidity": 0,
            "testValidityReason": "Fine.",
        }
    )
    assert parse(raw)["verdict"] == "reject"


@pytest.mark.parametrize(
    "raw",
    [
        "no json at all",
        graded(4, 0),
        graded(-1, 0),
        graded(0, 1.5),
        graded(0, "1"),
        graded(0, True),
        graded(0, 0, under_reason=""),
        graded(0, 0, valid_reason="  "),
        '{"underspecification": 0, "underspecificationReason": "x", "testValidity": 0}',
    ],
)
def test_parse_label_rejects_malformed_scores(raw):
    with pytest.raises(ValueError):
        parse(raw)


def test_prompt_defines_both_scales(task):
    prompt = labeler.build_prompt(task)
    for text in (
        "underspecification",
        "testValidity",
        "almost impossible to know what is asked",
        "too narrow, too broad, or check something else",
        "accept every reasonable solution",
    ):
        assert text in prompt
    assert '"verdict"' not in prompt


def test_prompt_digest_is_stable(task):
    assert labeler.prompt_digest(labeler.build_prompt(task)) == labeler.prompt_digest(
        labeler.build_prompt(task)
    )


def test_parse_label_accepts_braces_inside_the_reason():
    raw = graded(0, 0, "The empty object {} case is stated.", "Checks {} too.")
    assert parse(raw)["underspecificationReason"] == "The empty object {} case is stated."


def test_main_keeps_the_raw_response_when_parsing_fails(task, tmp_path, monkeypatch):
    output = tmp_path / "label.json"
    monkeypatch.setattr(labeler, "run_labeler", lambda task, model: "no verdict here")
    monkeypatch.setattr(
        "sys.argv", ["label-task.py", str(task), "--output", str(output)]
    )
    with pytest.raises(ValueError):
        labeler.main()
    assert (tmp_path / "label.json.raw.txt").read_text() == "no verdict here"
    assert not output.exists()

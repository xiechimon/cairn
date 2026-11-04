import importlib.util
from pathlib import Path
import subprocess

import pytest


SPEC = importlib.util.spec_from_file_location(
    "pr_to_task", Path(__file__).with_name("pr-to-task.py")
)
converter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(converter)


@pytest.fixture
def repository(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], text=True
        ).strip()

    git("init")
    git("config", "user.email", "fixture@example.com")
    git("config", "user.name", "Fixture")
    (repo / "add.py").write_text("def add(a, b):\n    return a - b\n")
    git("add", "add.py")
    git("commit", "-m", "base")
    base = git("rev-parse", "HEAD")
    (repo / "add.py").write_text("def add(a, b):\n    return a + b\n")
    (repo / "test_add.py").write_text(
        "from add import add\ndef test_add():\n    assert add(2, 3) == 5\n"
    )
    git("add", "add.py", "test_add.py")
    git("commit", "-m", "fix\n\nCloses #42")
    return repo, base, git("rev-parse", "HEAD")


def test_separates_answers_and_runs_both_controls(repository, tmp_path):
    repo, base, head = repository
    task = tmp_path / "task"
    converter.convert(
        repo,
        base,
        head,
        "Add positive numbers.\n",
        task,
        ["python3", "-m", "pytest", "test_add.py"],
        42,
    )
    assert "Add positive numbers.\n" in (task / "instruction.md").read_text()
    assert "diff --git" not in (task / "instruction.md").read_text()
    assert base in (task / "environment/Dockerfile").read_text()
    assert "test_add.py" not in (task / "solution/solution.patch").read_text()
    assert "test_add.py" in (task / "tests/tests.patch").read_text()
    archive = subprocess.check_output(
        ["tar", "tf", str(task / "environment/base.tar")], text=True
    )
    assert "test_add.py" not in archive
    assert ".git/" not in archive
    for solved in (False, True):
        work = tmp_path / str(solved)
        work.mkdir()
        subprocess.run(
            ["tar", "xf", str(task / "environment/base.tar"), "-C", str(work)],
            check=True,
        )
        subprocess.run(
            ["git", "apply", str(task / "tests/tests.patch")], cwd=work, check=True
        )
        if solved:
            subprocess.run(
                ["git", "apply", str(task / "solution/solution.patch")],
                cwd=work,
                check=True,
            )
        run = subprocess.run(
            ["python3", "-m", "pytest", "test_add.py"],
            cwd=work,
            capture_output=True,
            text=True,
        )
        assert run.returncode == (0 if solved else 1), run.stdout + run.stderr
        if not solved:
            assert "AssertionError" in run.stdout


@pytest.mark.parametrize(
    "path", ["../escape.test.ts", "/escape.test.ts", "bad\n.test.ts"]
)
def test_rejects_unsafe_paths(path):
    with pytest.raises(ValueError):
        converter.validate_path(path)


def test_selection_rejects_ambiguous_and_ineligible_candidates():
    common = dict(
        merged="2026-10-01T00:00:00Z",
        message="Closes #42",
        product_lines=30,
        paths=["a.ts", "a.test.ts"],
    )
    assert converter.selection_reason(**common) is None
    for changed in [
        dict(message="Closes #42\nCloses #43"),
        dict(product_lines=19),
        dict(product_lines=401),
        dict(paths=["apps/web/e2e/a.spec.ts", "a.ts"]),
        dict(paths=["integration/eval/a.ts", "a.test.ts"]),
        dict(merged="2026-06-30T00:00:00Z"),
        dict(paths=["a.ts"]),
    ]:
        assert converter.selection_reason(**(common | changed))


def test_control_classification_refuses_infrastructure_failures():
    assert (
        converter.classify_control(
            {"verifier_result": {"rewards": {"reward": 0}}, "exception_info": None},
            "Error: Cannot find module x",
            "nop",
        )
        == "infrastructure"
    )
    assert (
        converter.classify_control(
            {"verifier_result": {"rewards": {"reward": 0}}, "exception_info": None},
            "AssertionError: expected 5",
            "nop",
        )
        == "fail"
    )
    assert (
        converter.classify_control(
            {
                "verifier_result": {"rewards": {"reward": 1}},
                "exception_info": {"exception_type": "Timeout"},
            },
            "",
            "oracle",
        )
        == "infrastructure"
    )
    assert (
        converter.classify_control(
            {"verifier_result": {"rewards": {"reward": 1}}, "exception_info": None},
            "",
            "oracle",
        )
        == "pass"
    )


def test_internal_parent_link_does_not_escape_archive(repository, tmp_path):
    repo, _, _ = repository
    (repo / "nested").mkdir()
    (repo / "nested/source").symlink_to("../add.py")
    subprocess.run(["git", "add", "nested/source"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "internal link"], cwd=repo, check=True)
    base = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo, text=True
    ).strip()
    (repo / "add.py").write_text("def add(a, b):\n    return a * b\n")
    (repo / "test_add.py").write_text(
        "from add import add\ndef test_add():\n    assert add(2, 3) == 6\n"
    )
    subprocess.run(["git", "add", "add.py", "test_add.py"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "change"], cwd=repo, check=True)
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo, text=True
    ).strip()
    converter.convert(repo, base, head, "Fixture", tmp_path / "task", ["true"], 42)


@pytest.mark.parametrize("command", ["true", [], [""], {"cmd": "true"}])
def test_rejects_non_array_test_commands(repository, tmp_path, command):
    repo, base, head = repository
    with pytest.raises(ValueError):
        converter.convert(repo, base, head, "Fixture", tmp_path / "task", command, 42)

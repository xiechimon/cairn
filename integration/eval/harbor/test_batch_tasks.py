import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile

import pytest


SPEC = importlib.util.spec_from_file_location(
    "batch_tasks", Path(__file__).with_name("batch_tasks.py")
)
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)


def test_node_test_files_run_with_node():
    command = batch.test_command(
        [("scripts/a.test.mjs", "import test from 'node:test';\n")]
    )
    assert command == ["node", "--test", "scripts/a.test.mjs"]


def test_vitest_files_run_with_pnpm_exec_vitest():
    command = batch.test_command(
        [("apps/server/test/a.test.ts", "import { test } from 'vitest';\n")]
    )
    assert command == ["pnpm", "exec", "vitest", "run", "apps/server/test/a.test.ts"]


def test_mixed_runners_chain_in_one_shell_command():
    command = batch.test_command(
        [
            ("scripts/a.test.mjs", "import test from 'node:test';\n"),
            ("apps/server/test/b.test.ts", "import { test } from 'vitest';\n"),
        ]
    )
    assert command[:2] == ["sh", "-c"]
    assert "node --test scripts/a.test.mjs && pnpm exec vitest run apps/server/test/b.test.ts" == command[2]


def test_helpers_and_snapshots_are_not_run_directly():
    command = batch.test_command(
        [
            ("apps/server/test/helpers.ts", "export const x = 1;\n"),
            ("packages/shared/test/__snapshots__/a.test.ts.snap", "x"),
            ("packages/shared/test/a.test.ts", "import { test } from 'vitest';\n"),
        ]
    )
    assert command == ["pnpm", "exec", "vitest", "run", "packages/shared/test/a.test.ts"]


def test_no_runnable_test_file_is_an_error():
    with pytest.raises(ValueError):
        batch.test_command([("apps/server/test/helpers.ts", "export {};\n")])


@pytest.mark.parametrize(
    "text",
    [
        "await fetch('https://example.com/x')",
        "execSync('npm install left-pad')",
        "execSync('git clone https://github.com/a/b')",
        "execSync('pnpm dlx tool')",
    ],
)
def test_network_use_is_flagged(text):
    assert batch.network_findings(text)


@pytest.mark.parametrize(
    "text",
    ["fetch('http://127.0.0.1:' + port)", "const url = 'http://localhost:3000/x'", "assert.equal(1, 1)"],
)
def test_loopback_and_plain_code_are_not_flagged(text):
    assert batch.network_findings(text) == []


def test_protected_solution_paths_are_listed():
    assert batch.protected_solution_paths(["package.json", "src/a.ts", "tsconfig.json"]) == [
        "package.json",
        "tsconfig.json",
    ]


@pytest.fixture
def task(tmp_path):
    source = tmp_path / "src"
    source.mkdir()
    (source / "add.py").write_text("def add(a, b):\n    return a - b\n")
    archive = tmp_path / "task/environment/base.tar"
    archive.parent.mkdir(parents=True)
    with tarfile.open(archive, "w") as contents:
        contents.add(source / "add.py", arcname="add.py")
    for name in ("tests", "solution"):
        (tmp_path / "task" / name).mkdir()
    fixed = tmp_path / "fixed"
    fixed.mkdir()
    (fixed / "add.py").write_text("def add(a, b):\n    return a + b\n")
    (fixed / "test_add.py").write_text("from add import add\n")
    def diff(path):
        result = subprocess.run(
            ["git", "diff", "--no-index", "--binary", str(source / path), str(fixed / path)],
            capture_output=True,
            text=True,
        )
        return result.stdout.replace(str(source) + "/", "").replace(str(fixed) + "/", "")
    return tmp_path / "task", diff


def test_static_check_accepts_applicable_patches(task):
    directory, _ = task
    (directory / "solution/solution.patch").write_text(
        "--- a/add.py\n+++ b/add.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n"
    )
    (directory / "tests/tests.patch").write_text(
        "--- /dev/null\n+++ b/test_add.py\n@@ -0,0 +1 @@\n+from add import add\n"
    )
    for name, text in (
        ("grader-paths.txt", "test_add.py\n"),
        ("solution-paths.txt", "add.py\n"),
        ("protected-paths.txt", "pnpm-lock.yaml\n"),
        ("protected-regex.txt", "x\n"),
    ):
        (directory / "tests" / name).write_text(text)
    result = batch.static_check(directory)
    assert result["testsApplyToBase"] is True
    assert result["solutionAppliesOnTests"] is True
    assert result["problems"] == []


def test_static_check_reports_patch_that_does_not_apply(task):
    directory, _ = task
    (directory / "solution/solution.patch").write_text(
        "--- a/add.py\n+++ b/add.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a * b\n+    return a + b\n"
    )
    (directory / "tests/tests.patch").write_text("")
    for name in ("grader-paths.txt", "solution-paths.txt", "protected-paths.txt", "protected-regex.txt"):
        (directory / "tests" / name).write_text("x\n")
    result = batch.static_check(directory)
    assert result["solutionAppliesOnTests"] is False
    assert result["problems"]


def test_controls_script_runs_tasks_sequentially_without_nesting_the_heavy_lock(tmp_path):
    script = batch.controls_script(tmp_path / "tasks", tmp_path / "out", ["task-1", "task-2"])
    assert script.count("--check") == 2
    assert script.count("--cheat-controls") == 2
    assert "task-2" in script
    assert "flock /tmp/cairn-heavy.lock" not in script
    assert "flock /tmp/cairn-eval-batch.lock" in script


def test_only_accepted_tasks_get_controls(tmp_path):
    for name, verdict in (("task-1", "accept"), ("task-2", "reject"), ("task-3", "accept")):
        task = tmp_path / name
        (task / "tests").mkdir(parents=True)
        (task / "instruction.md").write_text("issue")
        (task / "tests/tests.patch").write_text("patch")
        labeler = batch.load("label_task", "label-task.py")
        digest = labeler.prompt_digest(labeler.build_prompt(task))
        (task / "label.openai.json").write_text(json.dumps({"verdict": verdict, "promptSha256": digest}))
    (tmp_path / "task-4").mkdir()
    assert batch.accepted_tasks(tmp_path) == ["task-1", "task-3"]


def test_discovery_keeps_only_prs_after_the_last_scanned_one_in_order():
    prs = [{"number": 5}, {"number": 2046}, {"number": 2045}, {"number": 2050}]
    assert [pr["number"] for pr in batch.prs_after(prs, 2045)] == [2046, 2050]


def test_discovery_row_records_a_failure_instead_of_raising():
    def inspect(pr):
        raise ValueError("bad object")

    row = batch.discover_row({"number": 9}, inspect)
    assert row == {"pr": 9, "reason": "Discovery infrastructure failure: bad object"}


def test_accepted_label_is_rejected_after_the_instruction_changes(tmp_path):
    task = tmp_path / "task-1"
    (task / "tests").mkdir(parents=True)
    (task / "instruction.md").write_text("original")
    (task / "tests/tests.patch").write_text("test patch")
    labeler = batch.load("label_task", "label-task.py")
    digest = labeler.prompt_digest(labeler.build_prompt(task))
    (task / "label.openai.json").write_text(
        '{"verdict":"accept","promptSha256":"' + digest + '"}'
    )
    assert batch.accepted_tasks(tmp_path) == ["task-1"]
    (task / "instruction.md").write_text("original plus Interface")
    assert batch.accepted_tasks(tmp_path) == []

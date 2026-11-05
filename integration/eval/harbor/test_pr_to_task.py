import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tomllib

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
        [sys.executable, "-m", "pytest", "test_add.py"],
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
            [sys.executable, "-m", "pytest", "test_add.py"],
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


def test_missing_reward_is_infrastructure_for_both_controls():
    for agent in ("oracle", "nop"):
        assert (
            converter.classify_control(
                {"verifier_result": None, "exception_info": None},
                "AssertionError: expected 5",
                agent,
            )
            == "infrastructure"
        )


def test_nop_that_passes_is_not_a_failed_control():
    assert (
        converter.classify_control(
            {"verifier_result": {"rewards": {"reward": 1}}, "exception_info": None},
            "",
            "nop",
        )
        == "pass"
    )


@pytest.fixture
def edited_test_repository(tmp_path):
    repo = tmp_path / "edited-repo"
    repo.mkdir()

    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], text=True
        ).strip()

    git("init")
    git("config", "user.email", "fixture@example.com")
    git("config", "user.name", "Fixture")
    (repo / "add.py").write_text("def add(a, b):\n    return a - b\n")
    (repo / "test_add.py").write_text(
        "from add import add\ndef test_zero():\n    assert add(0, 0) == 0\n"
    )
    git("add", "add.py", "test_add.py")
    git("commit", "-m", "base")
    base = git("rev-parse", "HEAD")
    (repo / "add.py").write_text("def add(a, b):\n    return a + b\n")
    (repo / "test_add.py").write_text(
        "from add import add\ndef test_zero():\n    assert add(0, 0) == 0\n"
        "def test_add():\n    assert add(2, 3) == 5\n"
    )
    git("add", "add.py", "test_add.py")
    git("commit", "-m", "fix\n\nCloses #42")
    return repo, base, git("rev-parse", "HEAD")


@pytest.fixture
def edited_task(edited_test_repository, tmp_path):
    repo, base, head = edited_test_repository
    task = tmp_path / "edited-task"
    converter.convert(
        repo,
        base,
        head,
        "Add positive numbers.\n",
        task,
        [sys.executable, "-m", "pytest", "-q", "test_add.py"],
        42,
    )
    return task


def grade(task, tmp_path, agent_files, preseed=None):
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir(parents=True)
    app, tests, logs = sandbox / "app", sandbox / "tests", sandbox / "logs"
    app.mkdir()
    subprocess.run(
        ["tar", "xf", str(task / "environment/base.tar"), "-C", str(app)], check=True
    )
    tests.mkdir()
    for name in ("tests.patch", "grader-paths.txt", "protected-regex.txt", "protected-paths.txt", "solution-paths.txt", "test.sh"):
        (tests / name).write_bytes((task / "tests" / name).read_bytes())
    workspace = logs / "artifacts" / "workspace"
    workspace.mkdir(parents=True)
    (logs / "verifier").mkdir()
    for name, text in agent_files.items():
        (workspace / name).parent.mkdir(parents=True, exist_ok=True)
        (workspace / name).write_text(text)
    for name, text in (preseed or {}).items():
        (logs / "verifier" / name).write_text(text)
    script = re.sub(
        r"(?<![\w/.])/(app|tests|logs)\b",
        lambda match: f"{sandbox}/{match.group(1)}",
        (task / "tests/test.sh").read_text(),
    )
    run = subprocess.run(["sh", "-c", script], capture_output=True, text=True)
    reward = (logs / "verifier/reward.txt").read_text().strip()
    return reward, run, logs


FIXED_ADD = "def add(a, b):\n    return a + b\n"
BASE_TEST = (
    "from add import add\ndef test_zero():\n    assert add(0, 0) == 0\n"
)


def test_task_grades_in_a_separate_verifier_that_receives_the_workspace(edited_task):
    config = tomllib.loads((edited_task / "task.toml").read_text())
    assert config["verifier"]["environment_mode"] == "separate"
    assert config["artifacts"] == ["/logs/artifacts"]
    [hook] = config["verifier"]["collect"]
    assert "--exclude=node_modules" in hook["command"]
    assert "--exclude=.git" in hook["command"]
    assert "/logs/artifacts/workspace" in hook["command"]
    assert "network_mode: none" in (
        edited_task / "environment/docker-compose.yaml"
    ).read_text()


def test_grader_inputs_live_only_in_the_tests_directory(edited_task):
    assert (edited_task / "tests/grader-paths.txt").read_text() == "test_add.py\n"
    assert (edited_task / "tests/protected-paths.txt").read_text() == (
        "test_add.py\n"
    )
    assert (edited_task / "tests/solution-paths.txt").read_text() == "add.py\n"
    for name in ("environment", "solution"):
        for path in (edited_task / name).rglob("*"):
            assert path.name not in (
                "grader-paths.txt",
                "protected-paths.txt",
                "protected-regex.txt",
                "tests.patch",
            )


@pytest.mark.parametrize(
    "path",
    [
        "vitest.config.ts",
        "apps/web/vitest.config.mts",
        "apps/web/vitest.setup.ts",
        "vite.config.ts",
        "jest.config.js",
        "playwright.config.ts",
        "package.json",
        "apps/server/package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "tsconfig.json",
        "packages/a/tsconfig.build.json",
        "src/a.test.ts",
        "src/a.spec.mjs",
        "conftest.py",
        "pytest.ini",
        "test_add.py",
        "test/helper.mjs",
        "apps/x/__tests__/a.ts",
        "e2e/a.ts",
        "src/fixtures/a.json",
    ],
)
def test_protected_pattern_covers_test_infrastructure(path):
    assert converter.is_protected(path)
    grep = subprocess.run(
        ["grep", "-E", converter.PROTECTED_REGEX], input=path + "\n", text=True
    )
    assert grep.returncode == 0


@pytest.mark.parametrize(
    "path",
    ["src/add.py", "docs/guide.md", "scripts/gate.mjs", "apps/web/src/App.tsx"],
)
def test_protected_pattern_leaves_product_code_alone(path):
    assert not converter.is_protected(path)


PYTEST_PASS_ALL = (
    "import pytest\n\n@pytest.hookimpl(hookwrapper=True)\n"
    "def pytest_runtest_makereport(item, call):\n"
    "    outcome = yield\n    outcome.get_result().outcome = 'passed'\n"
)


@pytest.fixture
def infrastructure_task(tmp_path):
    repo = tmp_path / "infra-repo"
    repo.mkdir()

    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo), *args], text=True
        ).strip()

    git("init")
    git("config", "user.email", "fixture@example.com")
    git("config", "user.name", "Fixture")
    (repo / "add.py").write_text("def add(a, b):\n    return a - b\n")
    (repo / "package.json").write_text('{"version": 1}\n')
    (repo / "conftest.py").write_text("")
    (repo / "vitest.config.ts").write_text("export default {}\n")
    (repo / "test_add.py").write_text(BASE_TEST)
    git("add", "-A")
    git("commit", "-m", "base")
    base = git("rev-parse", "HEAD")
    (repo / "add.py").write_text(FIXED_ADD)
    (repo / "package.json").write_text('{"version": 2}\n')
    (repo / "test_add.py").write_text(
        BASE_TEST + "def test_add():\n    assert add(2, 3) == 5\n"
    )
    git("add", "-A")
    git("commit", "-m", "fix\n\nCloses #42")
    task = tmp_path / "infra-task"
    converter.convert(
        repo,
        base,
        git("rev-parse", "HEAD"),
        "Fix.\n",
        task,
        [sys.executable, "-m", "pytest", "-q", "test_add.py"],
        42,
    )
    return task


def test_protected_list_is_auditable_and_excludes_solution_paths(infrastructure_task):
    listed = (infrastructure_task / "tests/protected-paths.txt").read_text().split()
    assert listed == ["conftest.py", "test_add.py", "vitest.config.ts"]
    assert (infrastructure_task / "tests/solution-paths.txt").read_text().split() == [
        "add.py",
        "package.json",
    ]


def test_edited_test_infrastructure_is_restored(infrastructure_task, tmp_path):
    reward, _, logs = grade(
        infrastructure_task,
        tmp_path,
        {"conftest.py": PYTEST_PASS_ALL, "vitest.config.ts": "export default {exclude: ['*']}\n"},
    )
    assert reward == "0"
    assert "AssertionError" in (logs / "verifier/test-output.txt").read_text()
    app = tmp_path / "sandbox/app"
    assert (app / "conftest.py").read_text() == ""
    assert (app / "vitest.config.ts").read_text() == "export default {}\n"


def test_planted_test_infrastructure_is_removed(infrastructure_task, tmp_path):
    reward, _, logs = grade(
        infrastructure_task,
        tmp_path,
        {
            "pytest.ini": "[pytest]\naddopts = --collect-only\n",
            "tests/helper.py": "x = 1\n",
            "vitest.setup.ts": "stub\n",
        },
    )
    app = tmp_path / "sandbox/app"
    assert reward == "0"
    assert not (app / "pytest.ini").exists()
    assert not (app / "tests/helper.py").exists()
    assert not (app / "vitest.setup.ts").exists()


def test_solution_touched_files_are_not_restored(infrastructure_task, tmp_path):
    reward, _, _ = grade(
        infrastructure_task,
        tmp_path,
        {"add.py": FIXED_ADD, "package.json": '{"version": 2}\n'},
    )
    assert reward == "1"
    assert (tmp_path / "sandbox/app/package.json").read_text() == '{"version": 2}\n'


def test_empty_protected_set_still_grades(repository, tmp_path):
    repo, base, head = repository
    task = tmp_path / "plain-task"
    converter.convert(
        repo,
        base,
        head,
        "Add.\n",
        task,
        [sys.executable, "-m", "pytest", "-q", "test_add.py"],
        42,
    )
    assert (task / "tests/protected-paths.txt").read_text() == ""
    reward, _, _ = grade(task, tmp_path / "run", {"add.py": FIXED_ADD})
    assert reward == "1"


def test_verifier_passes_a_real_fix_and_fails_the_unfixed_workspace(edited_task, tmp_path):
    reward, _, _ = grade(edited_task, tmp_path / "fixed", {"add.py": FIXED_ADD})
    assert reward == "1"
    reward, run, logs = grade(edited_task, tmp_path / "unfixed", {})
    assert reward == "0"
    assert "AssertionError" in (logs / "verifier/test-output.txt").read_text()


@pytest.mark.parametrize(
    "tamper",
    [
        {"test_add.py": "def test_add():\n    assert True\n"},
        {"test_add.py": ""},
        {"test_add.py": BASE_TEST + "def test_add():\n    assert True\n"},
    ],
)
def test_verifier_restores_the_grader_before_scoring(edited_task, tmp_path, tamper):
    reward, _, logs = grade(edited_task, tmp_path, tamper)
    assert reward == "0"
    assert "AssertionError" in (logs / "verifier/test-output.txt").read_text()


def test_verifier_ignores_preseeded_rewards(edited_task, tmp_path):
    reward, _, logs = grade(
        edited_task,
        tmp_path,
        {},
        preseed={"reward.txt": "1\n", "reward.json": '{"reward": 1}'},
    )
    assert reward == "0"
    assert not (logs / "verifier/reward.json").exists()


def test_verifier_drops_planted_dependency_and_git_directories(edited_task, tmp_path):
    reward, _, logs = grade(
        edited_task,
        tmp_path,
        {"node_modules/evil/index.js": "x", ".git/config": "x", "add.py": FIXED_ADD},
    )
    app = tmp_path / "sandbox/app"
    assert reward == "1"
    assert not (app / "node_modules").exists()
    assert not (app / ".git").exists()


def test_collect_command_publishes_the_workspace_without_dependencies(edited_task, tmp_path):
    config = tomllib.loads((edited_task / "task.toml").read_text())
    command = config["verifier"]["collect"][0]["command"]
    sandbox = tmp_path / "collect"
    (sandbox / "app/node_modules/dep").mkdir(parents=True)
    (sandbox / "app/node_modules/dep/index.js").write_text("x")
    (sandbox / "app/.git").mkdir()
    (sandbox / "app/pkg/node_modules").mkdir(parents=True)
    (sandbox / "app/add.py").write_text(FIXED_ADD)
    (sandbox / "logs/artifacts").mkdir(parents=True)
    script = re.sub(
        r"(?<![\w/.])/(app|logs)\b",
        lambda match: f"{sandbox}/{match.group(1)}",
        command,
    )
    subprocess.run(["sh", "-c", script], check=True)
    published = sandbox / "logs/artifacts/workspace"
    assert (published / "add.py").read_text() == FIXED_ADD
    assert not list(published.rglob("node_modules"))
    assert not (published / ".git").exists()


def test_cheat_arguments_carry_base_sha_needle_and_grader_paths(edited_task):
    arguments = converter.cheat_arguments(edited_task, "bash")
    assert arguments[:2] == ["-a", "cheat_agent:CheatAgent"]
    values = [arguments[index + 1] for index in range(2, len(arguments), 2)]
    assert "mode=bash" in values
    assert "needle=return a + b" in values
    assert "tests=test_add.py" in values
    assert any(value.startswith("base_sha=") and len(value) == 49 for value in values)


def test_cheat_trials_are_classified_like_a_nop_control():
    failed = {"verifier_result": {"rewards": {"reward": 0}}, "exception_info": None}
    assert converter.classify_control(failed, "AssertionError: x", "cheatgit") == "fail"
    passed = {"verifier_result": {"rewards": {"reward": 1}}, "exception_info": None}
    assert converter.classify_control(passed, "", "cheatbash") == "pass"

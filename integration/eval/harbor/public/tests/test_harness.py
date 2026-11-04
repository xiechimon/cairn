import json
import re
from pathlib import Path

from cairn_harbor import harness

WORKFLOW = harness.REPO_ROOT / ".github" / "workflows" / "eval-gate.yml"


def test_a_diff_touching_no_harness_path_does_not_trigger() -> None:
    assert not harness.touches_harness(
        ["README.md", "apps/web/src/app.tsx", "integration/eval/harbor/public/cairn_harbor/report.py"]
    )


def test_an_empty_diff_does_not_trigger() -> None:
    assert not harness.touches_harness([])


def test_an_exact_harness_file_triggers() -> None:
    assert harness.touches_harness(["apps/daemon/src/backend/pi.ts"])


def test_a_file_under_a_directory_pattern_triggers() -> None:
    assert harness.touches_harness(["integration/eval/harbor/public/skills/cairn-worker/SKILL.md"])


def test_a_sibling_directory_with_a_shared_prefix_does_not_trigger() -> None:
    assert not harness.touches_harness(
        ["integration/eval/harbor/public/skills/cairn-worker-other/SKILL.md"]
    )


def test_harness_sha_changes_with_content_and_ignores_other_files(tmp_path: Path) -> None:
    patterns = ["a.txt", "dir/**"]
    (tmp_path / "dir").mkdir()
    (tmp_path / "a.txt").write_text("one")
    (tmp_path / "dir" / "b.txt").write_text("two")
    (tmp_path / "unrelated.txt").write_text("x")
    first = harness.harness_sha(tmp_path, patterns)
    (tmp_path / "unrelated.txt").write_text("y")
    assert harness.harness_sha(tmp_path, patterns) == first
    (tmp_path / "dir" / "b.txt").write_text("three")
    assert harness.harness_sha(tmp_path, patterns) != first


def test_harness_sha_is_stable_hex() -> None:
    assert re.fullmatch(r"[0-9a-f]{64}", harness.harness_sha())


def test_every_harness_pattern_names_something_that_exists() -> None:
    for pattern in harness.harness_patterns():
        base = harness.REPO_ROOT / pattern.removesuffix("/**")
        assert base.exists(), pattern


def test_workflow_path_filters_equal_the_harness_definition() -> None:
    text = WORKFLOW.read_text()
    listed = re.findall(r"^\s+- '([^']+)'$", text.split("paths:")[1].split("jobs:")[0], re.M)
    assert sorted(listed) == sorted(harness.harness_patterns())


def test_paths_file_is_valid_json() -> None:
    assert json.loads(harness.HARNESS_PATHS_FILE.read_text())["paths"]

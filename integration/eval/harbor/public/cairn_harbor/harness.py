import hashlib
import json
from pathlib import Path

HARNESS_PATHS_FILE = Path(__file__).resolve().parent.parent / "harness-paths.json"
REPO_ROOT = Path(__file__).resolve().parents[5]
DIRECTORY_SUFFIX = "/**"


def harness_patterns(paths_file: Path = HARNESS_PATHS_FILE) -> list[str]:
    return list(json.loads(paths_file.read_text())["paths"])


def _matches(path: str, pattern: str) -> bool:
    if pattern.endswith(DIRECTORY_SUFFIX):
        return path.startswith(pattern[: -len(DIRECTORY_SUFFIX) + 1])
    return path == pattern


def touches_harness(changed_files: list[str], patterns: list[str] | None = None) -> bool:
    active = harness_patterns() if patterns is None else patterns
    return any(_matches(path, pattern) for path in changed_files for pattern in active)


def harness_sha(root: Path = REPO_ROOT, patterns: list[str] | None = None) -> str:
    active = harness_patterns() if patterns is None else patterns
    files: list[Path] = []
    for pattern in active:
        if pattern.endswith(DIRECTORY_SUFFIX):
            base = root / pattern[: -len(DIRECTORY_SUFFIX)]
            files.extend(path for path in base.rglob("*") if path.is_file())
        elif (root / pattern).is_file():
            files.append(root / pattern)
    digest = hashlib.sha256()
    for path in sorted(set(files)):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


RULER_ROOT = "integration/eval/"
RULER_FILES = (".github/workflows/eval-gate.yml",)
SKIPPED_DIRECTORIES = frozenset({".venv", "__pycache__", "node_modules", ".pytest_cache"})


def is_ruler_path(path: str, patterns: list[str] | None = None) -> bool:
    active = harness_patterns() if patterns is None else patterns
    if path in RULER_FILES:
        return True
    in_eval = path.startswith(RULER_ROOT) and not SKIPPED_DIRECTORIES.intersection(path.split("/"))
    return in_eval and not any(_matches(path, pattern) for pattern in active)


def ruler_files(root: Path, patterns: list[str] | None = None) -> list[str]:
    candidates = [
        path.relative_to(root).as_posix()
        for path in (root / RULER_ROOT).rglob("*")
        if path.is_file()
    ]
    candidates.extend(name for name in RULER_FILES if (root / name).is_file())
    return sorted(name for name in candidates if is_ruler_path(name, patterns))


def ruler_digest(root: Path, patterns: list[str] | None = None) -> str:
    digest = hashlib.sha256()
    for name in ruler_files(root, patterns):
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256((root / name).read_bytes()).digest())
    return digest.hexdigest()

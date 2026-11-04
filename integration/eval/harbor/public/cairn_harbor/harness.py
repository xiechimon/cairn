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

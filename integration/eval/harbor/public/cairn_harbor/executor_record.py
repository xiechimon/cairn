import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

RECORD_FILE_NAME = "executor-record.json"
RECORD_KEYS = ("backend", "model", "harness_sha", "effort")


@dataclass(frozen=True)
class ExecutorRecord:
    backend: str
    model: str
    harness_sha: str
    effort: str | None

    def to_json(self) -> dict:
        return asdict(self)


def _utf16_key(entry: dict) -> bytes:
    return entry["name"].encode("utf-16-be", errors="surrogatepass")


def compute_harness_sha(
    system_prompt: str, skills: list[dict], tools: list[dict]
) -> str:
    canonical = json.dumps(
        {
            "systemPrompt": system_prompt,
            "skills": sorted(
                ({"name": s["name"], "content": s["content"]} for s in skills),
                key=_utf16_key,
            ),
            "tools": sorted(
                ({"name": t["name"], "description": t["description"]} for t in tools),
                key=_utf16_key,
            ),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_executor_record(
    backend: str,
    model: str,
    effort: str | None,
    system_prompt: str,
    skills: list[dict],
    tools: list[dict],
) -> ExecutorRecord:
    return ExecutorRecord(
        backend=backend,
        model=model,
        harness_sha=compute_harness_sha(system_prompt, skills, tools),
        effort=effort or None,
    )


def load_skills(skills_dir: Path) -> list[dict]:
    skills = []
    for skill_file in sorted(skills_dir.glob("**/SKILL.md")):
        skills.append(
            {
                "name": skill_file.parent.name,
                "content": skill_file.read_text(encoding="utf-8"),
            }
        )
    return skills

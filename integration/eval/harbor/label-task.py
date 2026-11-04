import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

BANNED_MODELS = re.compile(r"gpt-6-astra|gpt-5\.6|minimax-m3|deepseek-v4-flash", re.I)
QUESTION = (
    "Decide whether two experts would agree that the tests in the test patch verify "
    "the requirement described in the issue: a correct implementation passes them, an "
    "incorrect or missing one fails them, and they do not demand behavior the issue "
    "does not state."
)


def require_allowed_model(model):
    if BANNED_MODELS.search(model):
        raise ValueError(f"banned model: {model}")


def build_prompt(task):
    task = Path(task)
    instruction = (task / "instruction.md").read_text()
    tests = (task / "tests/tests.patch").read_text()
    return (
        "You are reviewing a software task for a benchmark. You see only the issue and the "
        "test patch. Do not run commands or read any other files.\n\n"
        f"{QUESTION}\n\n"
        "Answer with one JSON object and nothing after it: "
        '{"verdict": "accept" or "reject", "reason": "<one or two sentences>"}\n\n'
        f"=== ISSUE ===\n{instruction}\n=== TEST PATCH ===\n{tests}\n=== END ===\n"
    )


def prompt_digest(prompt):
    return hashlib.sha256(prompt.encode()).hexdigest()


def codex_command(model, output, workdir, prompt):
    require_allowed_model(model)
    return [
        "codex",
        "exec",
        "-m",
        model,
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "-C",
        str(workdir),
        "-o",
        str(output),
        prompt,
    ]


def parse_label(raw, model, digest, labeled_at):
    require_allowed_model(model)
    found = None
    for match in re.finditer(r"\{[^{}]*\}", raw):
        try:
            candidate = json.loads(match.group())
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict) and "verdict" in candidate:
            found = candidate
    if found is None:
        raise ValueError("No JSON verdict in labeler output")
    reason = found.get("reason")
    if found["verdict"] not in ("accept", "reject") or not isinstance(reason, str) or not reason.strip():
        raise ValueError("Verdict must be accept or reject with a reason")
    return {
        "vendor": "openai",
        "model": model,
        "verdict": found["verdict"],
        "reason": reason.strip(),
        "labeledAt": labeled_at,
        "promptSha256": digest,
        "route": "direct-codex-exec",
    }


def label(task, model):
    prompt = build_prompt(task)
    with tempfile.TemporaryDirectory() as scratch:
        output = Path(scratch) / "last-message.txt"
        subprocess.run(
            codex_command(model, output, scratch, prompt),
            stdin=subprocess.DEVNULL,
            text=True,
            check=True,
            capture_output=True,
            timeout=900,
        )
        raw = output.read_text()
    return parse_label(
        raw, model, prompt_digest(prompt), datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    )


def main():
    parser = argparse.ArgumentParser(description="Cross-vendor label for a converted task")
    parser.add_argument("task", type=Path)
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(label(args.task, args.model), indent=2) + "\n")


if __name__ == "__main__":
    main()

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

BANNED_MODELS = re.compile(r"gpt-6-astra|gpt-5\.6|minimax-m3|deepseek-v4-flash", re.I)
RUBRIC = "graded-v1"
UNDERSPECIFICATION = (
    "0 = well specified; 1 = some blanks to fill, but a sensible interpretation of what a "
    "solution needs exists; 2 = vague, room for ambiguity, unclear what a solution looks like; "
    "3 = almost impossible to know what is asked without more information."
)
TEST_VALIDITY = (
    "0 = the tests accept every reasonable solution; 1 = the tests accept most reasonable "
    "solutions, though some unusual valid ones could fail; 2 = the tests check behavior the "
    "issue does not ask for (names, messages, schemas) and would reject many reasonable "
    "solutions; 3 = the tests are too narrow, too broad, or check something else."
)
SCORES = (
    ("underspecification", "underspecificationReason"),
    ("testValidity", "testValidityReason"),
)
ACCEPT_AT_MOST = 1


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
        "Score the task on two scales from 0 to 3.\n\n"
        f"underspecification: {UNDERSPECIFICATION}\n\n"
        f"testValidity: {TEST_VALIDITY}\n\n"
        "Answer with one JSON object and nothing after it: "
        '{"underspecification": <0-3>, "underspecificationReason": "<one or two sentences>", '
        '"testValidity": <0-3>, "testValidityReason": "<one or two sentences>"}\n\n'
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


def valid_scores(candidate):
    for score, reason in SCORES:
        value = candidate.get(score)
        text = candidate.get(reason)
        if (
            type(value) is not int
            or not 0 <= value <= 3
            or not isinstance(text, str)
            or not text.strip()
        ):
            return False
    return True


def parse_label(raw, model, digest, labeled_at):
    require_allowed_model(model)
    decoder = json.JSONDecoder()
    found = None
    position = raw.find("{")
    while position != -1:
        try:
            candidate, end = decoder.raw_decode(raw, position)
        except json.JSONDecodeError:
            position = raw.find("{", position + 1)
            continue
        if isinstance(candidate, dict) and "underspecification" in candidate:
            found = candidate
        position = raw.find("{", end)
    if found is None or not valid_scores(found):
        raise ValueError("No valid graded scores in labeler output")
    accepted = all(found[score] <= ACCEPT_AT_MOST for score, _ in SCORES)
    return {
        "vendor": "openai",
        "model": model,
        "rubric": RUBRIC,
        "underspecification": found["underspecification"],
        "underspecificationReason": found["underspecificationReason"].strip(),
        "testValidity": found["testValidity"],
        "testValidityReason": found["testValidityReason"].strip(),
        "verdict": "accept" if accepted else "reject",
        "labeledAt": labeled_at,
        "promptSha256": digest,
        "route": "direct-codex-exec",
    }


def run_labeler(prompt, model):
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
        return output.read_text()


def main():
    parser = argparse.ArgumentParser(description="Cross-vendor label for a converted task")
    parser.add_argument("task", type=Path)
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prompt = build_prompt(args.task)
    raw = run_labeler(prompt, args.model)
    args.output.with_name(f"{args.output.name}.raw.txt").write_text(raw)
    label = parse_label(
        raw, args.model, prompt_digest(prompt), datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    )
    args.output.write_text(json.dumps(label, indent=2) + "\n")


if __name__ == "__main__":
    main()

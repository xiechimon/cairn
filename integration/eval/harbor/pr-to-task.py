import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import shlex
import subprocess
import tarfile
import time


HARBOR_VERSION = "0.25.0"
ROOT = Path(__file__).resolve().parents[3]
REPOSITORY = "xiechimon/cairn"


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True)


def validate_path(path):
    if (
        not path
        or PurePosixPath(path).is_absolute()
        or ".." in PurePosixPath(path).parts
        or re.search(r"[\x00-\x20\\]", path)
    ):
        raise ValueError(f"Unsafe patch path: {path!r}")
    return path


def is_test(path):
    return bool(
        re.search(
            r"(?:^|/)(?:test|tests|__tests__)/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|/)test_[^/]+\.py$",
            path,
        )
    )


def closing_issues(message):
    return sorted(
        set(int(number) for number in re.findall(r"\bcloses\s+#(\d+)\b", message, re.I))
    )


def selection_reason(merged, message, product_lines, paths):
    if not merged or merged < "2026-07-01T00:00:00Z":
        return "Not merged on or after 2026-07-01"
    if len(closing_issues(message)) != 1:
        return "Requires exactly one closes #N issue reference"
    if any(path.startswith("integration/eval/") for path in paths):
        return "Touches the evaluation surface"
    if any(
        "/e2e/" in f"/{path}" or "e2e.test." in path or "playwright" in path.lower()
        for path in paths
    ):
        return "Contains Playwright or e2e tests"
    if all(
        is_test(path)
        or path.startswith("docs/")
        or path.endswith((".md", ".txt", ".log"))
        for path in paths
    ):
        return "Only documentation or tests change"
    if not any(is_test(path) for path in paths):
        return "No added or changed regression tests"
    if not 20 <= product_lines <= 400:
        return "Non-test diff outside 20-400 lines"
    return None


def patch_paths(repo, base, head):
    names = (
        run(
            "git",
            "diff",
            "--no-renames",
            "--name-only",
            "-z",
            "--diff-filter=ACDMRT",
            base,
            head,
            cwd=repo,
        )
        .rstrip("\0")
        .split("\0")
    )
    for name in names:
        validate_path(name)
    return names


def convert(repo, base, head, issue_body, destination, command, issue):
    for sha in (base, head):
        if not re.fullmatch(r"[a-f0-9]{40}", sha):
            raise ValueError("Expected full commit SHA")
    paths = patch_paths(repo, base, head)
    tests = [path for path in paths if is_test(path)]
    product = [path for path in paths if not is_test(path)]
    if not tests or not product:
        raise ValueError("Both product changes and regression tests are required")
    if (
        not isinstance(command, list)
        or not command
        or not all(isinstance(arg, str) and arg for arg in command)
    ):
        raise ValueError("Expected a nonempty test command argument array")
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for directory in ("environment", "tests", "solution"):
        (destination / directory).mkdir()
    for directory, filename, files in (
        ("tests", "tests.patch", tests),
        ("solution", "solution.patch", product),
    ):
        patch = run(
            "git",
            "diff",
            "--binary",
            "--no-renames",
            base,
            head,
            "--",
            *files,
            cwd=repo,
        )
        (destination / directory / filename).write_text(patch)
    archive = destination / "environment/base.tar"
    subprocess.run(
        ["git", "archive", "--format=tar", f"--output={archive.resolve()}", base],
        cwd=repo,
        check=True,
    )
    with tarfile.open(archive) as contents:
        for member in contents:
            validate_path(member.name.rstrip("/"))
            if member.issym() or member.islnk():
                target = PurePosixPath(member.linkname)
                resolved = posixpath.normpath(
                    posixpath.join(posixpath.dirname(member.name), member.linkname)
                )
                if (
                    target.is_absolute()
                    or resolved == ".."
                    or resolved.startswith("../")
                ):
                    raise ValueError(
                        "Base archive contains a link escaping the source tree"
                    )
    fence = "`" * max(
        3,
        max(
            (len(match.group()) + 1 for match in re.finditer(r"`+", issue_body)),
            default=3,
        ),
    )
    (destination / "instruction.md").write_text(
        f"# Issue {issue}\n\nBase revision: `{base}`\n\n{fence}text\n{issue_body}"
        + ("" if issue_body.endswith("\n") else "\n")
        + f"{fence}\n"
    )
    (destination / "environment/Dockerfile").write_text(
        "FROM node:24.14.0-bookworm\nRUN corepack enable\nWORKDIR /app\n"
        f'LABEL org.cairn.base-sha="{base}"\n'
        "ADD base.tar /app/\nRUN pnpm install --frozen-lockfile --ignore-scripts\n"
    )
    (destination / "environment/docker-compose.yaml").write_text(
        "services:\n  main:\n    network_mode: none\n"
    )
    (destination / "task.toml").write_text(
        'schema_version = "1.4"\n\n[metadata]\n'
        f'issue = {issue}\nbase_sha = "{base}"\nharbor_version = "{HARBOR_VERSION}"\n\n'
        "[agent]\ntimeout_sec = 600\n\n[verifier]\ntimeout_sec = 300\n\n"
        "[environment]\nbuild_timeout_sec = 1200\n"
    )
    (destination / "solution/solve.sh").write_text(
        "#!/bin/sh\nset -eu\ncd /app\ngit apply /solution/solution.patch\n"
    )
    (destination / "tests/test.sh").write_text(
        "#!/bin/sh\nset -eu\nmkdir -p /logs/verifier\nprintf '0\\n' > /logs/verifier/reward.txt\ncd /app\n"
        "git apply /tests/tests.patch\n"
        + shlex.join(command)
        + " > /logs/verifier/test-output.txt 2>&1\n"
        "printf '1\\n' > /logs/verifier/reward.txt\n"
    )
    return {
        "issue": issue,
        "baseSha": base,
        "partition": "optimize" if issue % 2 == 0 else "holdout",
        "testCommand": command,
        "patchDigest": hashlib.sha256(
            (destination / "solution/solution.patch").read_bytes()
        ).hexdigest(),
    }


def gh_json(*args):
    return json.loads(run("gh", *args))


def inspect_pr(number):
    pr = (
        number
        if isinstance(number, dict)
        else gh_json(
            "pr",
            "view",
            str(number),
            "-R",
            REPOSITORY,
            "--json",
            "number,mergedAt,mergeCommit,title",
        )
    )
    number = pr["number"]
    if not pr["mergedAt"] or not pr["mergeCommit"]:
        return {"pr": number, "title": pr["title"], "reason": "PR is not merged"}
    head = pr["mergeCommit"]["oid"]
    base = run("git", "rev-parse", f"{head}^", cwd=ROOT).strip()
    message = run("git", "show", "-s", "--format=%B", head, cwd=ROOT)
    paths = patch_paths(ROOT, base, head)
    stats = run("git", "diff", "--numstat", "-z", "--no-renames", base, head, cwd=ROOT)
    product_lines = 0
    for line in stats.rstrip("\0").split("\0"):
        added, deleted, path = line.split("\t", 2)
        if not is_test(path):
            if not added.isdigit() or not deleted.isdigit():
                return {
                    "pr": number,
                    "title": pr["title"],
                    "reason": "Binary non-test diff",
                }
            product_lines += int(added) + int(deleted)
    reason = selection_reason(pr["mergedAt"], message, product_lines, paths)
    return {
        "pr": number,
        "title": pr["title"],
        "mergedAt": pr["mergedAt"],
        "baseSha": base,
        "headSha": head,
        "issues": closing_issues(message),
        "paths": paths,
        "productLines": product_lines,
        "reason": reason,
    }


def classify_control(result, output, agent):
    if result.get("exception_info") or re.search(
        r"Cannot find module|ModuleNotFoundError|command not found|ECONNREFUSED|ENOTFOUND|SyntaxError|Timed? ?out",
        output,
        re.I,
    ):
        return "infrastructure"
    reward = (result.get("verifier_result") or {}).get("rewards", {}).get("reward")
    if reward == 1:
        return "pass"
    if (
        reward == 0
        and agent == "nop"
        and re.search(r"AssertionError|assert .* ==|expected .* to", output, re.I)
    ):
        return "fail"
    return "infrastructure"


def check_controls(task, output):
    prefix = ["uv", "tool", "run", "--from", f"harbor=={HARBOR_VERSION}", "harbor"]
    version = run(*prefix, "--version").strip()
    if version != HARBOR_VERSION:
        raise ValueError(f"Expected Harbor {HARBOR_VERSION}, got {version}")
    output.mkdir(parents=True, exist_ok=False)
    controls = {}
    for agent in ("oracle", "nop"):
        started = time.monotonic()
        log = output / f"{agent}.log"
        with log.open("w") as stream:
            trial = subprocess.run(
                [
                    *prefix,
                    "run",
                    "-p",
                    str(task.resolve()),
                    "-a",
                    agent,
                    "-n",
                    "1",
                    "--max-retries",
                    "0",
                    "--jobs-dir",
                    str(output.resolve() / agent),
                    "--yes",
                ],
                stdout=stream,
                stderr=subprocess.STDOUT,
                timeout=1800,
            )
        results = list((output / agent).glob("*/*/result.json"))
        status = "infrastructure"
        if len(results) == 1:
            result = json.loads(results[0].read_text())
            logs = list(results[0].parent.glob("verifier/test-output.txt"))
            output_text = "\n".join(path.read_text() for path in logs)
            status = classify_control(result, output_text, agent)
        controls[agent] = {
            "status": status,
            "log": str(log),
            "exitCode": trial.returncode,
            "wallSeconds": round(time.monotonic() - started, 3),
        }
        if status == "fail":
            controls[agent]["failureKind"] = "assertion"
        (output / "controls.json").write_text(json.dumps(controls, indent=2) + "\n")
    return controls


def main():
    parser = argparse.ArgumentParser(
        description="Convert merged Cairn PRs to isolated Harbor tasks"
    )
    parser.add_argument(
        "--check",
        type=Path,
        help="Run fresh oracle and nop controls for a generated task",
    )
    parser.add_argument("--pr", type=int)
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--test-command-json",
        help="Explicit offline command argument array; never inferred from issue text",
    )
    args = parser.parse_args()
    if args.check:
        print(json.dumps(check_controls(args.check, args.output), indent=2))
    elif args.discover:
        prs = gh_json(
            "pr",
            "list",
            "-R",
            REPOSITORY,
            "--state",
            "merged",
            "--limit",
            str(args.limit),
            "--json",
            "number,mergedAt,mergeCommit,title",
        )
        rows = []
        for pr in prs:
            try:
                row = inspect_pr(pr)
            except (subprocess.CalledProcessError, ValueError) as error:
                row = {
                    "pr": pr["number"],
                    "reason": f"Discovery infrastructure failure: {error}",
                }
            rows.append(row)
            print(
                f"{pr['number']}: {row.get('reason') or 'eligible for offline review'}",
                flush=True,
            )
        args.output.write_text(json.dumps(rows, indent=2) + "\n")
    elif args.pr and args.test_command_json:
        row = inspect_pr(args.pr)
        if row["reason"]:
            raise ValueError(row["reason"])
        issue = row["issues"][0]
        body = gh_json("issue", "view", str(issue), "-R", REPOSITORY, "--json", "body")[
            "body"
        ]
        metadata = convert(
            ROOT,
            row["baseSha"],
            row["headSha"],
            body,
            args.output,
            json.loads(args.test_command_json),
            issue,
        )
        (args.output / "provenance.json").write_text(
            json.dumps(row | metadata, indent=2) + "\n"
        )
    else:
        parser.error("Use --discover or --pr with --test-command-json")


if __name__ == "__main__":
    main()

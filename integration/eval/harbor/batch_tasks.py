import argparse
import importlib.util
import json
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


converter = load("pr_to_task", "pr-to-task.py")

NODE_TEST_FILE = re.compile(r"\.test\.[cm]?[jt]sx?$")
NETWORK_PATTERNS = [
    (re.compile(r"\b(?:npm|pnpm|yarn)\s+(?:install|add|dlx|i)\b"), "package install"),
    (re.compile(r"\bnpx\s+(?!--no-install)"), "npx download"),
    (re.compile(r"\bgit\s+(?:clone|fetch|pull|ls-remote)\s+\S*(?:https?|git|ssh)://"), "remote git"),
    (re.compile(r"\bgh\s+(?:api|pr|issue|repo)\b"), "gh cli"),
    (re.compile(r"\bcurl\s|\bwget\s"), "download tool"),
]
URL = re.compile(r"https?://([A-Za-z0-9.-]+)")
LOOPBACK = {"localhost", "127.0.0.1", "0.0.0.0"}
LOCK = "/tmp/cairn-eval-batch.lock"


def test_command(files):
    node, vitest = [], []
    for path, content in files:
        if not NODE_TEST_FILE.search(path):
            continue
        (node if "node:test" in content else vitest).append(path)
    parts = []
    if node:
        parts.append(["node", "--test", *node])
    if vitest:
        parts.append(["pnpm", "exec", "vitest", "run", *vitest])
    if not parts:
        raise ValueError("No runnable test file")
    if len(parts) == 1:
        return parts[0]
    return ["sh", "-c", " && ".join(shlex.join(part) for part in parts)]



def network_findings(text):
    findings = [label for pattern, label in NETWORK_PATTERNS if pattern.search(text)]
    findings += [
        f"url {host}" for host in URL.findall(text) if host not in LOOPBACK
    ]
    return findings


def protected_solution_paths(paths):
    return [path for path in paths if converter.is_protected(path)]


def apply(patch, directory):
    return (
        subprocess.run(
            ["git", "apply", "--whitespace=nowarn", str(patch)],
            cwd=directory,
            capture_output=True,
        ).returncode
        == 0
    )


def static_check(task):
    task = Path(task)
    problems = []
    with tempfile.TemporaryDirectory() as scratch:
        with tarfile.open(task / "environment/base.tar") as contents:
            contents.extractall(scratch, filter="data")
        tests_patch = (task / "tests/tests.patch").resolve()
        solution_patch = (task / "solution/solution.patch").resolve()
        tests_apply = apply(tests_patch, scratch) if tests_patch.stat().st_size else True
        solution_apply = apply(solution_patch, scratch)
    if not tests_apply:
        problems.append("tests.patch does not apply to base")
    if not solution_apply:
        problems.append("solution.patch does not apply on top of tests.patch")
    for name in ("grader-paths.txt", "solution-paths.txt", "protected-regex.txt"):
        if not (task / "tests" / name).read_text().strip():
            problems.append(f"{name} is empty")
    if not (task / "tests/protected-paths.txt").read_text().strip():
        problems.append("protected-paths.txt is empty")
    solution_paths = (task / "tests/solution-paths.txt").read_text().split()
    return {
        "testsApplyToBase": tests_apply,
        "solutionAppliesOnTests": solution_apply,
        "protectedSolutionPaths": protected_solution_paths(solution_paths),
        "problems": problems,
    }


def controls_script(tasks, output, names):
    script_path = Path(__file__).with_name("pr-to-task.py")
    lines = ["#!/bin/sh", "set -u", f"mkdir -p {shlex.quote(str(output))}"]
    for name in names:
        task = shlex.quote(str(Path(tasks) / name))
        for flag, suffix in (("--check", "controls"), ("--cheat-controls", "cheats")):
            destination = shlex.quote(str(Path(output) / f"{name}-{suffix}"))
            lines.append(
                f"flock {LOCK} python3 {shlex.quote(str(script_path))} "
                f"{flag} {task} --output {destination} "
                f"> {shlex.quote(str(Path(output) / f'{name}-{suffix}.log'))} 2>&1 "
                f"|| echo {shlex.quote(name + ' ' + suffix)} failed >> "
                f"{shlex.quote(str(Path(output) / 'failures.txt'))}"
            )
    return "\n".join(lines) + "\n"


def prs_after(prs, last):
    return sorted((pr for pr in prs if pr["number"] > last), key=lambda pr: pr["number"])


def discover_row(pr, inspect):
    try:
        return inspect(pr)
    except (subprocess.CalledProcessError, ValueError) as error:
        return {"pr": pr["number"], "reason": f"Discovery infrastructure failure: {error}"}


def discover_new(manifest_path):
    manifest = json.loads(Path(manifest_path).read_text())
    last = max(row["pr"] for row in manifest["candidates"])
    prs = converter.gh_json(
        "pr", "list", "-R", converter.REPOSITORY, "--state", "merged", "--limit", "5000",
        "--json", "number,mergedAt,mergeCommit,title",
    )
    rows = [discover_row(pr, converter.inspect_pr) for pr in prs_after(prs, last)]
    manifest["candidates"].extend(rows)
    manifest["scanned"] = len(manifest["candidates"])
    manifest["eligible"] = sum(1 for row in manifest["candidates"] if row.get("reason") is None)
    Path(manifest_path).write_text(json.dumps(manifest, indent=2) + "\n")
    return last, rows


def accepted_tasks(tasks):
    return sorted(
        label.parent.name
        for label in Path(tasks).glob("task-*/label.openai.json")
        if json.loads(label.read_text())["verdict"] == "accept"
    )


def git_show(repo, sha, path):
    return subprocess.check_output(["git", "show", f"{sha}:{path}"], cwd=repo, text=True)


def convert_pr(row, destination, repo):
    paths = row["paths"]
    tests = [path for path in paths if converter.is_test(path)]
    command = test_command([(path, git_show(repo, row["headSha"], path)) for path in tests if NODE_TEST_FILE.search(path)])
    issue = row["issues"][0]
    body = json.loads(
        subprocess.check_output(
            ["gh", "issue", "view", str(issue), "-R", converter.REPOSITORY, "--json", "body"],
            text=True,
        )
    )["body"]
    metadata = converter.convert(repo, row["baseSha"], row["headSha"], body, destination, command, issue)
    (Path(destination) / "provenance.json").write_text(json.dumps(row | metadata, indent=2) + "\n")
    return command


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    one = sub.add_parser("convert")
    one.add_argument("--manifest", type=Path, required=True)
    one.add_argument("--repo", type=Path, required=True)
    one.add_argument("--output", type=Path, required=True)
    one.add_argument("--report", type=Path, required=True)
    check = sub.add_parser("static")
    check.add_argument("--tasks", type=Path, required=True)
    check.add_argument("--report", type=Path, required=True)
    discover = sub.add_parser("discover-new")
    discover.add_argument("--manifest", type=Path, required=True)
    controls = sub.add_parser("controls-script")
    controls.add_argument("--tasks", type=Path, required=True)
    controls.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "discover-new":
        last, rows = discover_new(args.manifest)
        print(f"after {last}: {len(rows)} new, {sum(1 for r in rows if r.get('reason') is None)} eligible")
    elif args.action == "convert":
        rows = [
            row
            for row in json.loads(args.manifest.read_text())["candidates"]
            if row.get("reason") is None
        ]
        report = {}
        args.output.mkdir(parents=True, exist_ok=True)
        for row in rows:
            name = f"task-{row['pr']}"
            if (args.output / name).exists():
                report[row["pr"]] = {"status": "exists"}
                continue
            try:
                command = convert_pr(row, args.output / name, args.repo)
                report[row["pr"]] = {"status": "ok", "command": command}
            except Exception as error:
                report[row["pr"]] = {"status": "failed", "reason": f"{type(error).__name__}: {error}"}
            print(row["pr"], report[row["pr"]]["status"], flush=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    elif args.action == "static":
        report = {}
        for task in sorted(args.tasks.glob("task-*")):
            result = static_check(task)
            patch = (task / "tests/tests.patch").read_text()
            command = json.loads((task / "provenance.json").read_text())["testCommand"]
            result["networkFindings"] = network_findings(patch + " ".join(command))
            report[task.name] = result
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    else:
        names = accepted_tasks(args.tasks)
        print(controls_script(args.tasks, args.output, names), end="")


if __name__ == "__main__":
    main()

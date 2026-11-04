import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shlex
import subprocess
import tarfile
import time
import tomllib


HARBOR_VERSION = "0.25.0"
HEAVY_LOCK = os.environ.get("CAIRN_HEAVY_LOCK", "/tmp/cairn-heavy.lock")
ROOT = Path(__file__).resolve().parents[3]
REPOSITORY = "xiechimon/cairn"
_PROBE_SPEC = importlib.util.spec_from_file_location(
    "control_probe", Path(__file__).with_name("control_probe.py")
)
probe = importlib.util.module_from_spec(_PROBE_SPEC)
_PROBE_SPEC.loader.exec_module(probe)
_CHEAT_SPEC = importlib.util.spec_from_file_location(
    "cheat_controls", Path(__file__).with_name("cheat_controls.py")
)
cheats = importlib.util.module_from_spec(_CHEAT_SPEC)
_CHEAT_SPEC.loader.exec_module(cheats)


WORKSPACE_COLLECT = (
    "rm -rf /logs/artifacts/workspace && mkdir -p /logs/artifacts/workspace && cd /app "
    "&& tar --exclude=node_modules --exclude=.git -cf - . "
    "| tar -xf - -C /logs/artifacts/workspace"
)


def verifier_script(command):
    return (
        "#!/bin/sh\nset -eu\nmkdir -p /logs/verifier\n"
        "printf '0\\n' > /logs/verifier/reward.txt\n"
        "rm -f /logs/verifier/reward.json\ncd /app\n"
        "if [ -d /logs/artifacts/workspace ]; then\n"
        "  find /logs/artifacts/workspace \\( -name node_modules -o -name .git \\) "
        "-prune -exec rm -rf {} +\n"
        "  cp -a /logs/artifacts/workspace/. /app/\n"
        "fi\n"
        'while IFS= read -r path; do rm -rf -- "/app/$path"; done '
        "< /tests/grader-paths.txt\n"
        "tar -xf /tests/base-tests.tar -C /app\n"
        "git apply /tests/tests.patch\n"
        + shlex.join(command)
        + " > /logs/verifier/test-output.txt 2>&1\n"
        "printf '1\\n' > /logs/verifier/reward.txt\n"
    )


def write_grader_inputs(repo, base, tests, directory):
    (directory / "grader-paths.txt").write_text("".join(f"{path}\n" for path in tests))
    existing = [
        path
        for path in run(
            "git", "ls-tree", "-r", "--name-only", "-z", base, "--", *tests, cwd=repo
        )
        .rstrip("\0")
        .split("\0")
        if path
    ]
    archive = directory / "base-tests.tar"
    if existing:
        subprocess.run(
            ["git", "archive", "--format=tar", f"--output={archive.resolve()}", base, "--", *existing],
            cwd=repo,
            check=True,
        )
    else:
        tarfile.open(archive, "w").close()


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
        'schema_version = "1.4"\nartifacts = ["/logs/artifacts"]\n\n[metadata]\n'
        f'issue = {issue}\nbase_sha = "{base}"\nharbor_version = "{HARBOR_VERSION}"\n\n'
        "[agent]\ntimeout_sec = 600\n\n[verifier]\ntimeout_sec = 300\n"
        'environment_mode = "separate"\n\n'
        f"[[verifier.collect]]\ncommand = {json.dumps(WORKSPACE_COLLECT)}\n\n"
        "[environment]\nbuild_timeout_sec = 1200\n"
    )
    (destination / "solution/solve.sh").write_text(
        "#!/bin/sh\nset -eu\ncd /app\ngit apply /solution/solution.patch\n"
    )
    (destination / "tests/test.sh").write_text(verifier_script(command))
    write_grader_inputs(repo, base, tests, destination / "tests")
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
        and agent != "oracle"
        and re.search(r"AssertionError|assert .* ==|expected .* to", output, re.I)
    ):
        return "fail"
    return "infrastructure"


def harbor_prefix():
    prefix = ["uv", "tool", "run", "--from", f"harbor=={HARBOR_VERSION}", "harbor"]
    version = run(*prefix, "--version").strip()
    if version != HARBOR_VERSION:
        raise ValueError(f"Expected Harbor {HARBOR_VERSION}, got {version}")
    return prefix


def run_trial(prefix, task, name, agent_args, output, env=None):
    log = output / f"{name}.log"
    state, stop, sampler = probe.start_sampler(task.resolve().name)
    lock_requested = time.monotonic()
    with open(HEAVY_LOCK, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        lock_acquired = time.monotonic()
        with log.open("w") as stream:
            trial = subprocess.run(
                [
                    *prefix,
                    "run",
                    "-p",
                    str(task.resolve()),
                    *agent_args,
                    "-n",
                    "1",
                    "--max-retries",
                    "0",
                    "--jobs-dir",
                    str(output.resolve() / name),
                    "--yes",
                ],
                stdout=stream,
                stderr=subprocess.STDOUT,
                timeout=1800,
                env=env,
            )
        harbor_finished = time.monotonic()
    stop.set()
    sampler.join()
    results = list((output / name).glob("*/*/result.json"))
    status = "infrastructure"
    result = {}
    if len(results) == 1:
        result = json.loads(results[0].read_text())
        logs = list(results[0].parent.glob("verifier/test-output.txt"))
        output_text = "\n".join(path.read_text() for path in logs)
        status = classify_control(result, output_text, name)
    control = {
        "status": status,
        "log": str(log),
        "exitCode": trial.returncode,
        "timing": probe.timing_record(
            lock_requested, lock_acquired, harbor_finished, result, state.cpu_seconds()
        ),
        "isolation": state.isolation(),
    }
    if status == "fail":
        control["failureKind"] = "assertion"
    if len(results) == 1:
        probe.write_outcome(results[0].parent, name, {"status": status})
    return control, (results[0].parent if len(results) == 1 else None)


def check_controls(task, output):
    prefix = harbor_prefix()
    output.mkdir(parents=True, exist_ok=False)
    controls = {}
    wrote_outcome = False
    for agent in ("oracle", "nop"):
        controls[agent], trial = run_trial(
            prefix, task, agent, ["-a", agent], output
        )
        if trial:
            wrote_outcome = wrote_outcome or probe.agent_wrote_outcome(trial)
        (output / "controls.json").write_text(json.dumps(controls, indent=2) + "\n")
    controls["probe"] = probe.probe_verdict(controls["oracle"], controls["nop"], wrote_outcome)
    (output / "controls.json").write_text(json.dumps(controls, indent=2) + "\n")
    return controls


def cheat_arguments(task, mode):
    metadata = tomllib.loads((task / "task.toml").read_text())["metadata"]
    tests = (task / "tests/grader-paths.txt").read_text().split()
    needle = cheats.fix_needle(
        (task / "solution/solution.patch").read_text(), task / "environment/base.tar"
    )
    kwargs = {"mode": mode, "base_sha": metadata["base_sha"], "needle": needle}
    kwargs["tests"] = ",".join(tests)
    flags = [arg for key, value in kwargs.items() for arg in ("--ak", f"{key}={value}")]
    return ["-a", "cheat_agent:CheatAgent", *flags]


def check_cheats(task, output):
    prefix = harbor_prefix()
    output.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parent)}
    report = {}
    for mode in cheats.MODES:
        control, trial = run_trial(
            prefix, task, f"cheat{mode}", cheat_arguments(task, mode), output, env
        )
        evidence_file = trial / "agent" / f"cheat-{mode}.txt" if trial else None
        evidence = (
            cheats.parse_evidence(evidence_file.read_text())
            if evidence_file and evidence_file.is_file()
            else {}
        )
        outcome = json.loads((trial / "outcome.json").read_text()) if trial else {}
        report[mode] = {
            "control": control,
            "evidence": evidence,
            "agentWroteOutcome": probe.agent_wrote_outcome(trial) if trial else False,
            "outcome": outcome,
        }
        report[mode]["verdict"] = cheats.cheat_verdict(
            mode,
            control,
            evidence,
            report[mode]["agentWroteOutcome"],
            outcome,
        )
        (output / "cheats.json").write_text(json.dumps(report, indent=2) + "\n")
    report["passed"] = all(report[mode]["verdict"]["blocked"] for mode in cheats.MODES)
    (output / "cheats.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(
        description="Convert merged Cairn PRs to isolated Harbor tasks"
    )
    parser.add_argument(
        "--check",
        type=Path,
        help="Run fresh oracle and nop controls for a generated task",
    )
    parser.add_argument(
        "--cheat-controls",
        type=Path,
        help="Run the four cheat agents against a generated task",
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
    elif args.cheat_controls:
        print(json.dumps(check_cheats(args.cheat_controls, args.output), indent=2))
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

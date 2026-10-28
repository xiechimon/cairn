import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from cairn_harbor.costs import (
    parse_docker_stats_peak,
    parse_systemd_show,
    summarize_trial,
)
from cairn_harbor.report import arm_summary, build_report, scan_summary
from cairn_harbor.scan import scan_trial_dir
from cairn_harbor.subset import sample_task_names

SWE_DATASET_DIR_NAME = "swebench-verified"
TB_DATASET_DIR_NAME = "terminal-bench-2-1"

MODEL = "reflection/beam:free"
BASE_URL = "https://api.commandcode.ai/provider/v1"
API_KEY_NAME = "OPENAI_API_KEY"
AGENT_MODEL_API = "openai-completions"

CAIRN_IMPORT_PATH = "cairn_harbor.cairn_executor:CairnExecutor"
SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills" / "cairn-worker"


def agent_config(arm: str) -> dict:
    if arm == "oracle":
        return {"name": "oracle"}
    common = {
        "model_name": MODEL,
        "base_url": BASE_URL,
        "model_api_key_name": API_KEY_NAME,
        "kwargs": {"model_api": AGENT_MODEL_API},
    }
    if arm == "pi":
        return {"name": "pi", **common}
    if arm == "cairn":
        return {"import_path": CAIRN_IMPORT_PATH, "skills": [str(SKILLS_DIR)], **common}
    raise ValueError(f"unknown arm: {arm}")


def job_config(
    task_names: dict[str, list[str]],
    datasets_dir: Path,
    arm: str,
    job_name: str,
    n_attempts: int = 1,
) -> dict:
    tasks: list[dict] = []
    for dataset_name in (SWE_DATASET_DIR_NAME, TB_DATASET_DIR_NAME):
        for name in task_names.get(dataset_name, []):
            task_dir = datasets_dir / dataset_name / name
            if not task_dir.is_dir():
                raise FileNotFoundError(f"missing task directory: {task_dir}")
            tasks.append({"path": str(task_dir)})
    return {
        "job_name": job_name,
        "n_attempts": n_attempts,
        "agents": [agent_config(arm)],
        "tasks": tasks,
    }


def read_subset_seed(subset_path: Path | None) -> int:
    if subset_path is None:
        raise ValueError("a subset file with a seed is required")
    payload = json.loads(subset_path.read_text())
    if not isinstance(payload.get("seed"), int):
        raise ValueError("subset seed must be an integer")
    return payload["seed"]


def collect_outcomes(
    jobs_dir: Path, job_name: str, arm_label: str,
    harness_sessions: dict[str, list[Path]] | None = None,
):
    job_dir = jobs_dir / job_name
    outcomes = []
    if not job_dir.is_dir():
        return outcomes
    for trial_dir in sorted(job_dir.iterdir()):
        if not trial_dir.is_dir():
            continue
        findings = tuple(scan_trial_dir(
            trial_dir, harness_session_paths=(harness_sessions or {}).get(trial_dir.name)
        ))
        outcome = summarize_trial(
            trial_dir,
            name=trial_dir.name,
            voided=bool(findings),
            dataset=_dataset_for_trial(trial_dir),
            findings=findings,
        )
        outcomes.append(outcome)
    return outcomes


def _dataset_for_trial(trial_dir: Path) -> str:
    config = trial_dir / "config.json"
    try:
        payload = json.loads(config.read_text())
    except (OSError, ValueError):
        return ""
    task_path = str((payload.get("task") or {}).get("path") or "")
    if SWE_DATASET_DIR_NAME in task_path:
        return SWE_DATASET_DIR_NAME
    if TB_DATASET_DIR_NAME in task_path:
        return TB_DATASET_DIR_NAME
    return ""


def measure_trial_disk(jobs_dir: Path, job_name: str) -> dict[str, int]:
    job_dir = jobs_dir / job_name
    if not job_dir.is_dir():
        return {}
    return {
        trial_dir.name: _dir_bytes(trial_dir)
        for trial_dir in sorted(job_dir.iterdir())
        if trial_dir.is_dir()
    }


def _dir_bytes(path: Path) -> int:
    total = 0
    for entry in path.rglob("*"):
        if not entry.is_file():
            continue
        try:
            total += entry.stat().st_size
        except OSError:
            continue
    return total


def _peak_container_mib() -> dict[str, int]:
    try:
        stats = subprocess.run(
            ["docker", "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError):
        return {}
    peaks: dict[str, int] = {}
    for line in stats.stdout.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        mib = parse_docker_stats_peak(parts[-2])
        if mib is not None:
            peaks[parts[0]] = mib
    return peaks


def _cgroup_peak_bytes(unit_name: str) -> int | None:
    try:
        shown = subprocess.run(
            ["systemctl", "--user", "show", unit_name, "-p", "MemoryPeak"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    return parse_systemd_show(shown.stdout)


def systemd_wrap_command(
    command: list[str], unit_name: str, memory_max: str, env: dict[str, str]
) -> list[str]:
    wrapped = [
        "systemd-run",
        "--user",
        "--unit",
        unit_name,
        "--collect",
        "--wait",
        "--pipe",
        "-p",
        f"MemoryMax={memory_max}",
    ]
    for key, value in env.items():
        wrapped.extend(["--setenv", f"{key}={value}"])
    wrapped.extend(["--", *command])
    return wrapped


def run_job(config_path: Path, jobs_dir: Path, n_concurrent: int, memory_max: str) -> dict:
    harbor = Path(__file__).resolve().parent.parent / ".venv" / "bin" / "harbor"
    unit_name = f"cairn-harbor-{int(time.time())}"
    command = [
        str(harbor),
        "run",
        "--config",
        str(config_path),
        "--jobs-dir",
        str(jobs_dir),
        "--n-concurrent",
        str(n_concurrent),
        "--yes",
    ]
    env = {key: os.environ[key] for key in (API_KEY_NAME,) if os.environ.get(key)}
    wrapped = systemd_wrap_command(command, unit_name, memory_max, env)
    peak_container_mib: dict[str, int] = {}
    process = subprocess.Popen(wrapped, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    while process.poll() is None:
        for name, mib in _peak_container_mib().items():
            peak_container_mib[name] = max(peak_container_mib.get(name, 0), mib)
        time.sleep(15)
    output = process.stdout.read().decode(errors="replace") if process.stdout else ""
    return {
        "return_code": process.returncode,
        "output_tail": output[-4000:],
        "peak_container_mib": peak_container_mib,
        "cgroup_peak_bytes": _cgroup_peak_bytes(unit_name),
        "unit_name": unit_name,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Cairn public benchmark baseline driver.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    select = subparsers.add_parser("select", help="Write the fixed task list.")
    select.add_argument("--swe-dir", type=Path, required=True)
    select.add_argument("--tb-dir", type=Path, required=True)
    select.add_argument("--seed", type=int, required=True)
    select.add_argument("--out", type=Path, required=True)

    config = subparsers.add_parser("job-config", help="Write a harbor job config.")
    config.add_argument("--tasks", type=Path, required=True)
    config.add_argument("--datasets-dir", type=Path, required=True)
    config.add_argument("--arm", choices=("pi", "cairn", "oracle"), required=True)
    config.add_argument("--job-name", type=str, required=True)
    config.add_argument("--out", type=Path, required=True)
    config.add_argument("--attempts", type=int, default=1)

    run = subparsers.add_parser("run", help="Run a job under a memory cgroup.")
    run.add_argument("--config", type=Path, required=True)
    run.add_argument("--jobs-dir", type=Path, required=True)
    run.add_argument("--arm-label", type=str, required=True)
    run.add_argument("--job-name", type=str, required=True)
    run.add_argument("--tasks", type=Path, required=True)
    run.add_argument("--harness-sessions", type=Path)
    run.add_argument("--n-concurrent", type=int, default=3)
    run.add_argument("--memory-max", type=str, default="20G")
    run.add_argument("--out-dir", type=Path, required=True)

    args = parser.parse_args()

    if args.command == "select":
        payload = {
            "seed": args.seed,
            SWE_DATASET_DIR_NAME: sample_task_names(args.swe_dir, 20, args.seed),
            TB_DATASET_DIR_NAME: sample_task_names(args.tb_dir, 20, args.seed + 1),
        }
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
        return

    if args.command == "job-config":
        payload = json.loads(args.tasks.read_text())
        config_payload = job_config(
            payload, args.datasets_dir, args.arm, args.job_name, args.attempts
        )
        args.out.write_text(json.dumps(config_payload, indent=2) + "\n")
        return

    if args.command == "run":
        seed = read_subset_seed(args.tasks)
        subset = json.loads(args.tasks.read_text())
        task_names = [
            name for dataset in (SWE_DATASET_DIR_NAME, TB_DATASET_DIR_NAME)
            for name in subset[dataset]
        ]
        harness_sessions = None
        if args.harness_sessions:
            manifest = json.loads(args.harness_sessions.read_text())
            harness_sessions = {
                trial: [Path(path) for path in paths]
                for trial, paths in manifest.items()
            }
            for paths in harness_sessions.values():
                for path in paths:
                    if not path.is_file():
                        raise ValueError(f"missing harness session: {path}")
        run_info = run_job(args.config, args.jobs_dir, args.n_concurrent, args.memory_max)
        outcomes = collect_outcomes(
            args.jobs_dir, args.job_name, args.arm_label, harness_sessions
        )
        payload = {
            "arm": args.arm_label,
            "job_name": args.job_name,
            "n_concurrent": args.n_concurrent,
            "memory_max": args.memory_max,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "return_code": run_info["return_code"],
            "output_tail": run_info["output_tail"],
            "peak_container_mib": run_info["peak_container_mib"],
            "cgroup_peak_bytes": run_info["cgroup_peak_bytes"],
            "trial_disk_bytes": measure_trial_disk(args.jobs_dir, args.job_name),
            "scan": scan_summary(outcomes),
            "trials": [outcome.__dict__ for outcome in outcomes],
        }
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / f"{args.arm_label}.json").write_text(
            json.dumps(payload, indent=2, default=str) + "\n"
        )
        report = build_report(
            arms={args.arm_label: arm_summary(outcomes, args.arm_label)},
            task_names=task_names,
            seed=seed,
            model=MODEL,
        )
        (args.out_dir / f"{args.arm_label}.report.md").write_text(report + "\n")


if __name__ == "__main__":
    main()

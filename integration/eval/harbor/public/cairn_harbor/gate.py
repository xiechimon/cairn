import argparse
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

from cairn_harbor import budget
from cairn_harbor.harness import is_ruler_path, ruler_digest, touches_harness

MIN_BASE_REPEATS = 5
MIN_PAIRED_TASKS = 5
Z_ALPHA = 1.96
Z_POWER = 0.8416

BETTER = "better"
WORSE = "worse"
NO_DIFFERENCE = "no-detectable-difference"
INSUFFICIENT = "insufficient-data"
BROKEN = "broken"
BLOCKING_VERDICTS = frozenset({WORSE, BROKEN, INSUFFICIENT})

EXIT_PASS = 0
EXIT_BLOCKED = 1
EXIT_REFUSED = 2


class GateRefused(ValueError):
    pass


@dataclass(frozen=True)
class GateResult:
    verdict: str
    delta: float | None = None
    mde: float | None = None
    tasks_paired: int = 0
    tasks_excluded: list[str] = field(default_factory=list)
    reason: str = ""

    @property
    def blocked(self) -> bool:
        return self.verdict in BLOCKING_VERDICTS


def _pin(runs: list[dict], key: str, label: str) -> str:
    if not runs:
        raise GateRefused(f"{label} arm has no runs")
    values = {run.get(key) for run in runs}
    if None in values or "" in values:
        raise GateRefused(f"{label} arm has a run without a pinned {key.replace('_', ' ')}")
    if len(values) != 1:
        raise GateRefused(f"{label} arm mixes several values of {key.replace('_', ' ')}")
    return values.pop()


def _task_key(trial: dict) -> str:
    return f"{trial.get('dataset', '')}/{trial['name']}"


def _scored(trial: dict) -> bool:
    return bool(trial["voided"]) or not trial["infra"]


def _score(trial: dict) -> float:
    return 1.0 if trial["passed"] and not trial["voided"] else 0.0


def _completed_agent_run(trial: dict) -> bool:
    return _scored(trial) and int(trial.get("tokens") or 0) > 0


def _scores_by_task(runs: list[dict]) -> dict[str, list[float]]:
    scores: dict[str, list[float]] = {}
    for run in runs:
        for trial in run["trials"]:
            if _scored(trial):
                scores.setdefault(_task_key(trial), []).append(_score(trial))
    return scores


def _all_tasks(runs: list[dict]) -> set[str]:
    return {_task_key(trial) for run in runs for trial in run["trials"]}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _sample_variance(values: list[float]) -> float:
    mean = _mean(values)
    return sum((value - mean) ** 2 for value in values) / (len(values) - 1)


def check_pins(base: list[dict], candidate: list[dict]) -> None:
    base_model = _pin(base, "model", "base")
    candidate_model = _pin(candidate, "model", "candidate")
    if base_model != candidate_model:
        raise GateRefused(f"model differs between arms: {base_model} vs {candidate_model}")
    base_tasks = _pin(base, "task_set_sha", "base")
    candidate_tasks = _pin(candidate, "task_set_sha", "candidate")
    if base_tasks != candidate_tasks:
        raise GateRefused("task set sha differs between arms")
    _pin(base, "harness_sha", "base")
    _pin(candidate, "harness_sha", "candidate")


def judge(base: list[dict], candidate: list[dict]) -> GateResult:
    check_pins(base, candidate)
    candidate_trials = [trial for run in candidate for trial in run["trials"]]
    if not any(_completed_agent_run(trial) for trial in candidate_trials):
        return GateResult(
            BROKEN, reason="the candidate completed no agent run: every trial is infrastructure or recorded no tokens"
        )
    if len(base) < MIN_BASE_REPEATS:
        return GateResult(
            INSUFFICIENT,
            reason=f"{len(base)} base repeats; the MDE needs at least {MIN_BASE_REPEATS}",
        )

    base_scores = _scores_by_task(base)
    candidate_scores = _scores_by_task(candidate)
    all_tasks = _all_tasks(base) | _all_tasks(candidate)
    paired = sorted(
        task
        for task in all_tasks
        if len(base_scores.get(task, [])) >= 2 and candidate_scores.get(task)
    )
    excluded = sorted(all_tasks - set(paired))
    if len(paired) < MIN_PAIRED_TASKS:
        return GateResult(
            INSUFFICIENT,
            tasks_paired=len(paired),
            tasks_excluded=excluded,
            reason=f"{len(paired)} paired tasks; at least {MIN_PAIRED_TASKS} are needed",
        )

    n_tasks = len(paired)
    delta = sum(_mean(candidate_scores[t]) - _mean(base_scores[t]) for t in paired) / n_tasks
    variance = sum(
        _sample_variance(base_scores[t])
        * (1 / len(base_scores[t]) + 1 / len(candidate_scores[t]))
        for t in paired
    ) / n_tasks**2
    floor = 1 / (n_tasks * len(candidate))
    mde = max((Z_ALPHA + Z_POWER) * math.sqrt(variance), floor)
    if delta >= mde:
        verdict = BETTER
    elif delta <= -mde:
        verdict = WORSE
    else:
        verdict = NO_DIFFERENCE
    return GateResult(verdict, delta, mde, n_tasks, excluded)


def build_results(result: GateResult, base: list[dict], candidate: list[dict]) -> dict:
    run_ids = [run["run_id"] for run in [*base, *candidate] if run.get("run_id")]
    settled = budget.settled_usd(run_ids)
    unsettled = sorted(run_id for run_id, usd in settled.items() if usd is None)
    cost = None if unsettled or not settled else sum(usd for usd in settled.values() if usd is not None)
    return {
        "verdict": result.verdict,
        "blocked": result.blocked,
        "reason": result.reason,
        "model": base[0]["model"],
        "taskSetSha": base[0]["task_set_sha"],
        "harnessShaBase": base[0]["harness_sha"],
        "harnessShaCandidate": candidate[0]["harness_sha"],
        "repeats": {"base": len(base), "candidate": len(candidate)},
        "delta": result.delta,
        "mde": result.mde,
        "mdeFormula": "(1.96 + 0.8416) * sqrt(sum_t(s2_t * (1/nb_t + 1/nc_t))) / N, floored at 1/(N * candidate repeats)",
        "tasksPaired": result.tasks_paired,
        "tasksExcluded": result.tasks_excluded,
        "costUsd": cost,
        "unsettledRuns": unsettled,
    }


def _load_runs(paths: list[str]) -> list[dict]:
    return [json.loads(Path(path).read_text()) for path in paths]


def _compare(args: argparse.Namespace) -> int:
    base, candidate = _load_runs(args.base), _load_runs(args.candidate)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = judge(base, candidate)
    except GateRefused as refusal:
        args.out.write_text(
            json.dumps({"verdict": "refused", "blocked": True, "reason": str(refusal)}, indent=2) + "\n"
        )
        print(f"eval gate refused: {refusal}", file=sys.stderr)
        return EXIT_REFUSED
    results = build_results(result, base, candidate)
    args.out.write_text(json.dumps(results, indent=2) + "\n")
    print(f"eval gate verdict: {result.verdict}" + (f" ({result.reason})" if result.reason else ""))
    return EXIT_BLOCKED if result.blocked else EXIT_PASS


def _trigger(args: argparse.Namespace) -> int:
    changed = [line.strip() for line in Path(args.files).read_text().splitlines() if line.strip()]
    return EXIT_PASS if touches_harness(changed) else EXIT_BLOCKED


def _ruler(args: argparse.Namespace) -> int:
    changed = [line.strip() for line in Path(args.files).read_text().splitlines() if line.strip()]
    touched = sorted(path for path in changed if is_ruler_path(path))
    reason = ""
    if touched:
        reason = f"refused: ruler changed: {', '.join(touched)}"
    else:
        expected = ruler_digest(args.ruler)
        differing = [str(arm.name) for arm in args.arm if ruler_digest(arm) != expected]
        if differing:
            reason = (
                "refused: ruler changed: "
                f"{', '.join(differing)} differs from the default branch ruler"
            )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    if reason:
        args.out.write_text(
            json.dumps({"verdict": "refused", "blocked": True, "reason": reason}, indent=2) + "\n"
        )
        print(f"eval gate {reason}", file=sys.stderr)
        return EXIT_REFUSED
    args.out.write_text(json.dumps({"verdict": "ruler-intact", "blocked": False}, indent=2) + "\n")
    return EXIT_PASS


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Paired harness regression gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    compare = subparsers.add_parser("compare")
    compare.add_argument("--base", nargs="+", required=True)
    compare.add_argument("--candidate", nargs="+", required=True)
    compare.add_argument("--out", type=Path, required=True)
    trigger = subparsers.add_parser("trigger")
    trigger.add_argument("--files", required=True)
    ruler = subparsers.add_parser("ruler")
    ruler.add_argument("--files", required=True)
    ruler.add_argument("--ruler", type=Path, required=True)
    ruler.add_argument("--arm", type=Path, action="append", default=[])
    ruler.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    handlers = {"compare": _compare, "trigger": _trigger, "ruler": _ruler}
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

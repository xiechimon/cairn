import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from cairn_harbor.scan import ScanFinding, scan_session_text

_UNIT_FACTORS = {
    "b": 1,
    "kb": 1_000,
    "mb": 1_000_000,
    "gb": 1_000_000_000,
    "kib": 1024,
    "mib": 1024**2,
    "gib": 1024**3,
    "tib": 1024**4,
}


@dataclass(frozen=True)
class StepUsage:
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class TrialCost:
    name: str
    dataset: str
    passed: bool
    voided: bool
    infra: bool
    wall_sec: float
    tokens: int
    findings: tuple[ScanFinding, ...]


def _read_json(path: Path) -> dict | None:
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def read_step_usage(trial_dir: Path) -> StepUsage:
    step_contexts: list[dict] = []
    result = _read_json(trial_dir / "result.json") or {}
    if isinstance(result.get("agent_result"), dict):
        step_contexts.append(result["agent_result"])
    per_step = [
        step["agent_result"]
        for step in (result.get("step_results") or [])
        if isinstance(step, dict) and isinstance(step.get("agent_result"), dict)
    ]
    if per_step:
        step_contexts.extend(per_step)
    else:
        for step_dir in sorted(trial_dir.glob("step-*")):
            step = _read_json(step_dir / "result.json") or {}
            if isinstance(step.get("agent_result"), dict):
                step_contexts.append(step["agent_result"])
    step_contexts = [json.dumps(context, sort_keys=True) for context in step_contexts]
    step_contexts = [json.loads(context) for context in dict.fromkeys(step_contexts)]
    input_tokens = sum(int(context.get("n_input_tokens") or 0) for context in step_contexts)
    output_tokens = sum(
        int(context.get("n_output_tokens") or 0) for context in step_contexts
    )
    return StepUsage(input_tokens=input_tokens, output_tokens=output_tokens)


def _parse_stamp(value: str | None) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _wall_sec(result: dict) -> float:
    spans: list[tuple[datetime, datetime]] = []
    direct = result.get("agent_execution")
    if isinstance(direct, dict):
        started = _parse_stamp(direct.get("started_at"))
        finished = _parse_stamp(direct.get("finished_at"))
        if started and finished:
            spans.append((started, finished))
    for step in result.get("step_results") or []:
        if not isinstance(step, dict):
            continue
        timing = step.get("agent_execution") or {}
        started = _parse_stamp(timing.get("started_at") if isinstance(timing, dict) else None)
        finished = _parse_stamp(timing.get("finished_at") if isinstance(timing, dict) else None)
        if started and finished:
            spans.append((started, finished))
    if not spans:
        started = _parse_stamp(result.get("started_at"))
        finished = _parse_stamp(result.get("finished_at"))
        if started and finished:
            spans = [(started, finished)]
    return sum(max(0.0, (end - start).total_seconds()) for start, end in spans)


def _has_exception(result: dict) -> bool:
    if result.get("exception_info") is not None:
        return True
    for step in result.get("step_results") or []:
        if isinstance(step, dict) and step.get("exception_info") is not None:
            return True
    return False


def _passed(result: dict, voided: bool) -> bool:
    if voided:
        return False
    rewards = (result.get("verifier_result") or {}).get("rewards") or {}
    return rewards.get("reward") == 1.0


def harness_session_paths(trial_dir: Path) -> list[Path]:
    agent_dir = trial_dir / "agent"
    paths: list[Path] = []
    for candidate in [
        agent_dir / "pi.txt",
        *(sorted((agent_dir / "pi" / "sessions").glob("*.jsonl"))),
    ]:
        if candidate.is_file():
            paths.append(candidate)
    return paths


def _session_findings(trial_dir: Path) -> tuple[ScanFinding, ...]:
    findings: list[ScanFinding] = []
    for path in harness_session_paths(trial_dir):
        findings.extend(
            scan_session_text(path.read_text(encoding="utf-8", errors="replace"))
        )
    return tuple(dict.fromkeys(findings))


def trial_task_name(trial_name: str) -> str:
    return trial_name.rsplit("__", 1)[0]


def summarize_trial(
    trial_dir: Path,
    *,
    name: str,
    voided: bool,
    dataset: str = "",
    findings: tuple[ScanFinding, ...] | None = None,
) -> TrialCost:
    result = _read_json(trial_dir / "result.json")
    if result is None:
        return TrialCost(
            name=trial_task_name(name),
            dataset=dataset,
            passed=False,
            voided=voided,
            infra=True,
            wall_sec=0.0,
            tokens=0,
            findings=findings or (),
        )
    usage = read_step_usage(trial_dir)
    if findings is None:
        findings = _session_findings(trial_dir)
    return TrialCost(
        name=trial_task_name(name),
        dataset=dataset,
        passed=_passed(result, voided),
        voided=voided,
        infra=_has_exception(result),
        wall_sec=_wall_sec(result),
        tokens=usage.input_tokens + usage.output_tokens,
        findings=findings,
    )


def parse_docker_stats_peak(value: str) -> int | None:
    used = value.split("/")[0].strip().lower()
    for unit in sorted(_UNIT_FACTORS, key=len, reverse=True):
        if used.endswith(unit):
            try:
                amount = float(used[: -len(unit)].strip())
            except ValueError:
                return None
            return int(amount * _UNIT_FACTORS[unit]) // (1024 * 1024)
    return None


def parse_systemd_show(stdout: str) -> int | None:
    for line in stdout.splitlines():
        if not line.startswith("MemoryPeak="):
            continue
        raw = line.split("=", 1)[1].strip()
        if not raw:
            return None
        try:
            return int(raw)
        except ValueError:
            return None
    return None

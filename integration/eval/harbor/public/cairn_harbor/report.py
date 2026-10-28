import math
from dataclasses import dataclass, field

from cairn_harbor.costs import TrialCost
from cairn_harbor.scan import ScanFinding


def wilson_interval(
    successes: int, trials: int, z: float = 1.96
) -> tuple[float, float]:
    if trials == 0:
        return (0.0, 0.0)
    p = successes / trials
    denom = 1 + z * z / trials
    center = (p + z * z / (2 * trials)) / denom
    half = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


@dataclass(frozen=True)
class ArmSummary:
    label: str
    total: int
    scored: int
    passed: int
    infra_failures: int
    voided: int
    pass_rate: float
    wilson_lower: float
    wilson_upper: float
    mean_wall_sec: float
    mean_tokens: float
    trial_rows: list[str] = field(default_factory=list)


def arm_summary(trials: list[TrialCost], label: str) -> ArmSummary:
    scored = [trial for trial in trials if not trial.infra and not trial.voided]
    passed = sum(1 for trial in scored if trial.passed)
    lower, upper = wilson_interval(passed, len(scored))
    wall_times = [trial.wall_sec for trial in scored if trial.wall_sec > 0]
    tokens = [trial.tokens for trial in scored if trial.tokens > 0]
    trial_rows = [
        f"| {trial.dataset} | {trial.name} | {_verdict(trial)} | "
        f"{trial.wall_sec:.0f}s | {trial.tokens} | "
        f"{', '.join(finding.value for finding in trial.findings) or '-'} |"
        for trial in trials
    ]
    return ArmSummary(
        label=label,
        total=len(trials),
        scored=len(scored),
        passed=passed,
        infra_failures=sum(1 for trial in trials if trial.infra),
        voided=sum(1 for trial in trials if trial.voided),
        pass_rate=passed / len(scored) if scored else 0.0,
        wilson_lower=lower,
        wilson_upper=upper,
        mean_wall_sec=sum(wall_times) / len(wall_times) if wall_times else 0.0,
        mean_tokens=sum(tokens) / len(tokens) if tokens else 0.0,
        trial_rows=trial_rows,
    )


def _verdict(trial: TrialCost) -> str:
    if trial.voided:
        return "voided"
    if trial.infra:
        return "infra"
    return "pass" if trial.passed else "fail"


def build_report(
    arms: dict[str, ArmSummary],
    task_names: list[str],
    seed: int,
    model: str,
) -> str:
    lines = [
        "# Cairn public benchmark baseline",
        "",
        f"- Model: `{model}` (same channel for every arm)",
        f"- Task list seed: `{seed}`",
        f"- Planned tasks: {len(task_names)}",
        f"- Collected trials: {sum(arm.total for arm in arms.values())}",
        "- Planned task list: " + ", ".join(f"`{name}`" for name in task_names),
        "",
        "Infra failures (image build errors, setup timeouts, provider outages) are",
        "counted separately and excluded from pass-rate denominators. A trial whose",
        "trajectory touched a test file or a benchmark site is voided and counted",
        "the same way, never as an agent failure.",
        "",
        "## Pass rates",
        "",
        "| Arm | Scored | Passed | Pass rate | Wilson 95% | Infra | Voided | Mean wall (s) | Mean tokens |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for label in sorted(arms):
        summary = arms[label]
        lines.append(
            f"| {label} | {summary.scored} | {summary.passed} | "
            f"{summary.pass_rate:.3f} | "
            f"[{summary.wilson_lower:.3f}, {summary.wilson_upper:.3f}] | "
            f"{summary.infra_failures} | {summary.voided} | "
            f"{summary.mean_wall_sec:.0f} | {summary.mean_tokens:.0f} |"
        )

    lines.extend(
        [
            "",
            "## Per-trial results",
            "",
            "| Dataset | Task | Verdict | Wall | Tokens | Scan |",
            "|---|---|---|---|---|---|",
        ]
    )
    for label in sorted(arms):
        lines.append("")
        lines.append(f"### Arm {label}")
        lines.extend(arms[label].trial_rows)
    lines.append("")
    return "\n".join(lines)


def scan_summary(trials: list[TrialCost]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for trial in trials:
        for finding in trial.findings:
            counts[finding.value] = counts.get(finding.value, 0) + 1
    for finding in ScanFinding:
        counts.setdefault(finding.value, 0)
    return counts

import json
import os
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from cairn_harbor import budget
from cairn_harbor.budget import BudgetExceeded, MissingCostError, resolve_cost
from cairn_harbor.costs import TrialCost, summarize_trial
from cairn_harbor.report import arm_summary, build_report

NOV = datetime(2026, 11, 15, tzinfo=timezone.utc)
DEC = datetime(2026, 12, 1, tzinfo=timezone.utc)


@pytest.fixture
def ledger(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state" / "spend.jsonl"
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(path))
    monkeypatch.delenv("CAIRN_EVAL_MONTHLY_CAP_USD", raising=False)
    return path


def entries(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_reserve_under_cap_writes_reserved_entry(ledger: Path) -> None:
    budget.reserve("run-1", 10.0, now=NOV)
    assert [e["kind"] for e in entries(ledger)] == ["reserved"]
    assert entries(ledger)[0]["month"] == "2026-11"


def test_default_cap_is_fifty_and_env_overrides(
    ledger: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert budget.monthly_cap_usd() == 50
    monkeypatch.setenv("CAIRN_EVAL_MONTHLY_CAP_USD", "12.5")
    assert budget.monthly_cap_usd() == 12.5


def test_reaching_the_cap_exactly_is_allowed_and_passing_it_is_refused(
    ledger: Path,
) -> None:
    budget.reserve("run-1", 30.0, now=NOV)
    budget.settle("run-1", 30.0, "agent-reported total_cost_usd", now=NOV)
    budget.reserve("run-2", 20.0, now=NOV)
    budget.settle("run-2", 20.0, "agent-reported total_cost_usd", now=NOV)
    with pytest.raises(BudgetExceeded):
        budget.reserve("run-3", 0.01, now=NOV)
    refused = entries(ledger)[-1]
    assert refused["kind"] == "refused"
    assert refused["run_id"] == "run-3"
    assert refused["spent_usd"] == 50.0
    assert refused["estimate_usd"] == 0.01
    assert refused["cap_usd"] == 50.0


def test_refused_entries_do_not_count_as_spend(ledger: Path) -> None:
    budget.reserve("run-1", 40.0, now=NOV)
    with pytest.raises(BudgetExceeded):
        budget.reserve("run-2", 20.0, now=NOV)
    budget.settle("run-1", 5.0, "agent-reported total_cost_usd", now=NOV)
    budget.reserve("run-3", 45.0, now=NOV)


def test_month_rollover_resets_spend(ledger: Path) -> None:
    budget.reserve("run-1", 50.0, now=NOV)
    budget.settle("run-1", 50.0, "agent-reported total_cost_usd", now=NOV)
    budget.reserve("run-2", 50.0, now=DEC)


def test_unsettled_reservation_counts_at_its_estimate(ledger: Path) -> None:
    budget.reserve("run-1", 40.0, now=NOV)
    with pytest.raises(BudgetExceeded):
        budget.reserve("run-2", 11.0, now=NOV)


def test_settle_replaces_the_estimate_with_the_actual(ledger: Path) -> None:
    budget.reserve("run-1", 40.0, now=NOV)
    budget.settle("run-1", 3.0, "tokens x price table", now=NOV)
    settled = entries(ledger)[-1]
    assert settled["kind"] == "settled"
    assert settled["actual_usd"] == 3.0
    assert settled["source"] == "tokens x price table"
    budget.reserve("run-2", 47.0, now=NOV)


def test_settle_without_reservation_is_rejected(ledger: Path) -> None:
    with pytest.raises(ValueError):
        budget.settle("ghost", 1.0, "agent-reported total_cost_usd", now=NOV)


def test_duplicate_open_reservation_is_rejected(ledger: Path) -> None:
    budget.reserve("run-1", 1.0, now=NOV)
    with pytest.raises(ValueError):
        budget.reserve("run-1", 1.0, now=NOV)


def test_ledger_file_is_0600_and_parent_0700(ledger: Path) -> None:
    budget.reserve("run-1", 1.0, now=NOV)
    assert stat.S_IMODE(ledger.stat().st_mode) == 0o600
    assert stat.S_IMODE(ledger.parent.stat().st_mode) == 0o700


def test_default_ledger_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CAIRN_EVAL_LEDGER", raising=False)
    assert budget.ledger_path() == Path.home() / ".local/state/cairn-eval/spend.jsonl"


def test_reported_usd_is_preferred() -> None:
    assert resolve_cost(1.25, 10, 10, "claude-x") == (
        1.25,
        "agent-reported total_cost_usd",
    )


def test_unknown_model_without_reported_usd_fails_closed() -> None:
    with pytest.raises(MissingCostError):
        resolve_cost(None, 1000, 1000, "claude-unpriced")


def test_known_model_is_priced_from_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(budget.PRICES_USD_PER_MTOK, "claude-test", (3.0, 15.0))
    assert resolve_cost(None, 1_000_000, 100_000, "claude-test") == (
        4.5,
        "tokens x price table",
    )


def test_no_tokens_and_no_report_costs_nothing_explicitly() -> None:
    assert resolve_cost(None, 0, 0, "claude-unpriced") == (
        0.0,
        "no tokens recorded",
    )


CHILD = """
import sys
from cairn_harbor import budget
try:
    budget.reserve(sys.argv[1], 6.0)
except budget.BudgetExceeded:
    print("refused")
else:
    print("reserved")
"""


def test_concurrent_reserve_across_processes_cannot_overspend(ledger: Path) -> None:
    env = {
        **os.environ,
        "CAIRN_EVAL_LEDGER": str(ledger),
        "CAIRN_EVAL_MONTHLY_CAP_USD": "10",
    }
    procs = [
        subprocess.Popen(
            [sys.executable, "-c", CHILD, f"run-{i}"],
            env=env,
            stdout=subprocess.PIPE,
            text=True,
        )
        for i in range(6)
    ]
    outcomes = [p.communicate()[0].strip() for p in procs]
    assert outcomes.count("reserved") == 1
    assert outcomes.count("refused") == 5


def test_trial_cost_uses_reported_usd_from_agent_result(tmp_path: Path) -> None:
    trial_dir = tmp_path / "task__abc"
    trial_dir.mkdir()
    (trial_dir / "result.json").write_text(
        json.dumps(
            {
                "agent_result": {
                    "n_input_tokens": 10,
                    "n_output_tokens": 5,
                    "cost_usd": 0.75,
                }
            }
        )
    )
    trial = summarize_trial(
        trial_dir, name=trial_dir.name, voided=False, model="claude-unpriced"
    )
    assert trial.cost_usd == 0.75
    assert trial.cost_source == "agent-reported total_cost_usd"


def test_unpriced_trial_without_report_keeps_its_result_with_unknown_cost(
    tmp_path: Path,
) -> None:
    trial_dir = tmp_path / "task__abc"
    trial_dir.mkdir()
    (trial_dir / "result.json").write_text(
        json.dumps({"agent_result": {"n_input_tokens": 10, "n_output_tokens": 5}})
    )
    trial = summarize_trial(
        trial_dir, name=trial_dir.name, voided=False, model="claude-unpriced"
    )
    assert trial.cost_usd is None
    assert trial.cost_source.startswith("unknown")


def _trial(cost: float | None) -> TrialCost:
    return TrialCost(
        name="t1",
        dataset="terminal-bench-2-1",
        passed=True,
        voided=False,
        infra=False,
        wall_sec=1.0,
        tokens=10,
        findings=(),
        cost_usd=cost,
    )


def test_report_includes_total_cost() -> None:
    summary = arm_summary([_trial(1.25), _trial(0.5)], label="A")
    assert summary.total_cost_usd == 1.75
    report = build_report(
        arms={"A": summary}, task_names=["t1"], seed=1, model="claude-x"
    )
    assert "Total cost: $1.75" in report
    assert "| $1.25 |" in report


def test_report_marks_unknown_cost_instead_of_zero() -> None:
    summary = arm_summary([_trial(1.0), _trial(None)], label="A")
    assert summary.total_cost_usd is None
    report = build_report(
        arms={"A": summary}, task_names=["t1"], seed=1, model="free"
    )
    assert "Total cost: unknown" in report


def test_partially_reported_step_costs_are_unknown(tmp_path: Path) -> None:
    trial_dir = tmp_path / "task__abc"
    trial_dir.mkdir()
    (trial_dir / "result.json").write_text(
        json.dumps(
            {
                "step_results": [
                    {"agent_result": {"n_input_tokens": 10, "cost_usd": 0.10}},
                    {"agent_result": {"n_input_tokens": 900, "n_output_tokens": 90}},
                ]
            }
        )
    )
    trial = summarize_trial(
        trial_dir, name=trial_dir.name, voided=False, model="claude-unpriced"
    )
    assert trial.cost_usd is None


def test_run_with_an_unknown_trial_cost_settles_at_its_reservation() -> None:
    usd, source = budget.settlement([_trial(0.5), _trial(None)], reserved_usd=4.0)
    assert usd == 4.0
    assert source == budget.UNKNOWN_SETTLED_AT_RESERVATION


def test_run_with_known_costs_settles_at_their_sum() -> None:
    usd, _ = budget.settlement([_trial(0.5), _trial(0.25)], reserved_usd=4.0)
    assert usd == 0.75


def test_run_spending_past_its_reservation_settles_at_the_actual() -> None:
    usd, _ = budget.settlement([_trial(6.0)], reserved_usd=4.0)
    assert usd == 6.0


def test_a_step_without_tokens_or_cost_does_not_hide_reported_costs(
    tmp_path: Path,
) -> None:
    trial_dir = tmp_path / "task__abc"
    trial_dir.mkdir()
    (trial_dir / "result.json").write_text(
        json.dumps(
            {
                "step_results": [
                    {"agent_result": {"n_input_tokens": 10, "cost_usd": 0.10}},
                    {"agent_result": {"n_input_tokens": 0}},
                ]
            }
        )
    )
    trial = summarize_trial(
        trial_dir, name=trial_dir.name, voided=False, model="claude-unpriced"
    )
    assert trial.cost_usd == 0.10


@pytest.mark.parametrize("amount", [-1.0, float("nan"), float("inf")])
def test_reserve_rejects_negative_or_non_finite_amounts(ledger: Path, amount: float) -> None:
    with pytest.raises(ValueError):
        budget.reserve("run-1", amount, now=NOV)
    assert not ledger.exists() or entries(ledger) == []


@pytest.mark.parametrize("amount", [-1.0, float("nan")])
def test_settle_rejects_negative_or_non_finite_amounts(ledger: Path, amount: float) -> None:
    budget.reserve("run-1", 5.0, now=NOV)
    with pytest.raises(ValueError):
        budget.settle("run-1", amount, "x", now=NOV)


def test_unknown_cost_settlement_never_drops_below_known_spending() -> None:
    usd, source = budget.settlement([_trial(60.0), _trial(None)], reserved_usd=4.0)
    assert usd == 60.0
    assert source == budget.UNKNOWN_SETTLED_AT_RESERVATION


def test_a_run_with_no_collected_trials_settles_at_its_reservation() -> None:
    usd, source = budget.settlement([], reserved_usd=4.0)
    assert usd == 4.0
    assert source == budget.UNKNOWN_SETTLED_AT_RESERVATION


def test_partially_unpriced_trial_keeps_its_known_step_spend_as_a_floor(
    tmp_path: Path,
) -> None:
    trial_dir = tmp_path / "task__abc"
    trial_dir.mkdir()
    (trial_dir / "result.json").write_text(
        json.dumps(
            {
                "step_results": [
                    {"agent_result": {"n_input_tokens": 10, "cost_usd": 60.0}},
                    {"agent_result": {"n_input_tokens": 900, "n_output_tokens": 90}},
                ]
            }
        )
    )
    trial = summarize_trial(
        trial_dir, name=trial_dir.name, voided=False, model="claude-unpriced"
    )
    assert trial.cost_usd is None
    assert trial.known_cost_usd == 60.0
    usd, source = budget.settlement([trial], reserved_usd=4.0)
    assert usd == 60.0
    assert source == budget.UNKNOWN_SETTLED_AT_RESERVATION


def test_settled_usd_reports_settled_runs_and_none_for_the_rest(ledger: Path) -> None:
    budget.reserve("done", 5.0, now=NOV)
    budget.settle("done", 2.5, "agent-reported total_cost_usd", now=NOV)
    budget.reserve("open", 5.0, now=NOV)
    assert budget.settled_usd(["done", "open", "never"]) == {
        "done": 2.5,
        "open": None,
        "never": None,
    }

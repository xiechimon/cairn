import fcntl
import json
import math
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Protocol, Sequence

DEFAULT_MONTHLY_CAP_USD = "50"
DEFAULT_LEDGER = Path.home() / ".local/state/cairn-eval/spend.jsonl"

REPORTED_SOURCE = "agent-reported total_cost_usd"
PRICE_TABLE_SOURCE = "tokens x price table"
NO_TOKENS_SOURCE = "no tokens recorded"
UNKNOWN_SETTLED_AT_RESERVATION = "unknown trial cost; settled at the reservation"

PRICES_USD_PER_MTOK: dict[str, tuple[float, float]] = {}


class CostedTrial(Protocol):
    cost_usd: float | None
    cost_source: str


class BudgetExceeded(Exception):
    pass


class MissingCostError(Exception):
    pass


def ledger_path() -> Path:
    override = os.environ.get("CAIRN_EVAL_LEDGER")
    return Path(override) if override else DEFAULT_LEDGER


def monthly_cap_usd() -> float:
    return float(os.environ.get("CAIRN_EVAL_MONTHLY_CAP_USD", DEFAULT_MONTHLY_CAP_USD))


def _month(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m")


def _now() -> datetime:
    return datetime.now(timezone.utc)


@contextmanager
def _locked_ledger():
    path = ledger_path()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_fd = os.open(f"{path}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        yield path
    finally:
        os.close(lock_fd)


def _read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _append(path: Path, entry: dict) -> None:
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(entry, sort_keys=True) + "\n").encode())
        os.fsync(fd)
    finally:
        os.close(fd)


def _open_reservations(entries: list[dict]) -> dict[str, dict]:
    open_runs: dict[str, dict] = {}
    for entry in entries:
        if entry["kind"] == "reserved":
            open_runs[entry["run_id"]] = entry
        elif entry["kind"] == "settled":
            open_runs.pop(entry["run_id"], None)
    return open_runs


def _committed_usd(entries: list[dict], month: str) -> Decimal:
    total = Decimal(0)
    for entry in entries:
        if entry.get("month") != month:
            continue
        if entry["kind"] == "settled":
            total += Decimal(str(entry["actual_usd"]))
    for entry in _open_reservations(entries).values():
        if entry["month"] == month:
            total += Decimal(str(entry["estimate_usd"]))
    return total


def _require_amount(usd: float) -> None:
    if not math.isfinite(usd) or usd < 0:
        raise ValueError(f"amount must be a finite non-negative number of USD, got {usd}")


def reserve(run_id: str, estimate_usd: float, now: datetime | None = None) -> None:
    _require_amount(estimate_usd)
    moment = now or _now()
    month = _month(moment)
    cap = Decimal(str(monthly_cap_usd()))
    with _locked_ledger() as path:
        entries = _read(path)
        if run_id in _open_reservations(entries):
            raise ValueError(f"run {run_id} already has an open reservation")
        committed = _committed_usd(entries, month)
        if committed + Decimal(str(estimate_usd)) > cap:
            _append(
                path,
                {
                    "kind": "refused",
                    "ts": moment.isoformat(),
                    "month": month,
                    "run_id": run_id,
                    "spent_usd": float(committed),
                    "estimate_usd": estimate_usd,
                    "cap_usd": float(cap),
                },
            )
            raise BudgetExceeded(
                f"run {run_id}: {committed} spent or reserved in {month} plus "
                f"{estimate_usd} would pass the {cap} USD monthly cap"
            )
        _append(
            path,
            {
                "kind": "reserved",
                "ts": moment.isoformat(),
                "month": month,
                "run_id": run_id,
                "estimate_usd": estimate_usd,
            },
        )


def settle(
    run_id: str, actual_usd: float, source: str, now: datetime | None = None
) -> None:
    _require_amount(actual_usd)
    moment = now or _now()
    with _locked_ledger() as path:
        reservation = _open_reservations(_read(path)).get(run_id)
        if reservation is None:
            raise ValueError(f"run {run_id} has no open reservation")
        _append(
            path,
            {
                "kind": "settled",
                "ts": moment.isoformat(),
                "month": reservation["month"],
                "run_id": run_id,
                "actual_usd": actual_usd,
                "source": source,
            },
        )


def resolve_cost(
    reported_usd: float | None,
    input_tokens: int,
    output_tokens: int,
    model: str,
) -> tuple[float, str]:
    if reported_usd is not None:
        return reported_usd, REPORTED_SOURCE
    if input_tokens + output_tokens == 0:
        return 0.0, NO_TOKENS_SOURCE
    prices = PRICES_USD_PER_MTOK.get(model)
    if prices is None:
        raise MissingCostError(
            f"no reported cost and no verified price for model {model}"
        )
    input_price, output_price = prices
    usd = (input_tokens * input_price + output_tokens * output_price) / 1_000_000
    return usd, PRICE_TABLE_SOURCE


def settlement(
    trials: Sequence[CostedTrial], reserved_usd: float
) -> tuple[float, str]:
    known = sum(trial.cost_usd for trial in trials if trial.cost_usd is not None)
    if not trials or any(trial.cost_usd is None for trial in trials):
        return max(reserved_usd, known), UNKNOWN_SETTLED_AT_RESERVATION
    sources = sorted({trial.cost_source for trial in trials if trial.cost_source})
    return known, "; ".join(sources) or NO_TOKENS_SOURCE

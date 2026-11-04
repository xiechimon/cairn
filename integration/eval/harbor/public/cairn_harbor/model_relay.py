import fcntl
import hashlib
import json
import math
import os
import threading
import uuid
from collections.abc import Callable, Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from cairn_harbor import budget

PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing"
PRICING_VERIFIED = "2026-11-04"
PRICES = {
    "claude-sonnet-5-5": ("2", "10", "2.5", "4", "0.1"),
    "claude-haiku-5-5": ("0.1", "0.5", "0.125", "0.2", "0.01"),
    "claude-opus-5-5": ("4", "20", "5", "8", "0.2"),
}
COUNT_FIELDS = frozenset(
    {
        "model",
        "messages",
        "system",
        "tools",
        "tool_choice",
        "thinking",
        "cache_control",
        "output_config",
    }
)
ALLOWED_FIELDS = COUNT_FIELDS | {
    "max_tokens",
    "stream",
    "temperature",
    "top_p",
    "top_k",
    "stop_sequences",
    "metadata",
}


class RelayRefused(ValueError):
    pass


@dataclass(frozen=True)
class RelayConfig:
    run_id: str
    model: str
    max_run_usd: float
    max_output_tokens: int
    report: Path
    max_input_tokens: int = 100_000


@dataclass
class UpstreamResponse:
    status: int
    content_type: str
    body: Iterable[bytes]


class RelaySession:
    def __init__(
        self, config: RelayConfig, transport: Callable[[str, dict], UpstreamResponse]
    ):
        if config.model not in PRICES:
            raise RelayRefused("model has no approved current pricing")
        if not math.isfinite(config.max_run_usd) or config.max_run_usd <= 0:
            raise RelayRefused("run cap must be finite and positive")
        if type(config.max_output_tokens) is not int or config.max_output_tokens <= 0:
            raise RelayRefused("output token ceiling must be a positive integer")
        if (
            type(config.max_input_tokens) is not int
            or not 0 < config.max_input_tokens <= 100_000
        ):
            raise RelayRefused("input ceiling must be within the verified pricing tier")
        self.config = config
        self.transport = transport
        self.charged = Decimal(0)
        self._lock = threading.Lock()

    @contextmanager
    def _run_budget(self):
        ledger = budget.ledger_path()
        ledger.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        identity = hashlib.sha256(self.config.run_id.encode()).hexdigest()
        prefix = f"relay:{identity}:messages:"
        descriptor = os.open(
            f"{ledger}.run-{identity}.lock", os.O_CREAT | os.O_RDWR, 0o600
        )
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            ledger_lock = os.open(f"{ledger}.lock", os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(ledger_lock, fcntl.LOCK_SH)
                entries = (
                    [
                        json.loads(line)
                        for line in ledger.read_text().splitlines()
                        if line.strip()
                    ]
                    if ledger.exists()
                    else []
                )
            finally:
                os.close(ledger_lock)
            calls = {}
            for entry in entries:
                call_id = entry.get("run_id", "")
                if not call_id.startswith(prefix):
                    continue
                if entry["kind"] == "reserved":
                    calls[call_id] = Decimal(str(entry["estimate_usd"]))
                elif entry["kind"] == "settled":
                    calls[call_id] = Decimal(str(entry["actual_usd"]))
            if any(not value.is_finite() or value < 0 for value in calls.values()):
                raise RelayRefused("invalid persisted run spend")
            self.charged = sum(calls.values(), Decimal(0))
            yield prefix
        finally:
            os.close(descriptor)

    def _validate(self, body: dict) -> None:
        if not isinstance(body, dict) or set(body) - ALLOWED_FIELDS:
            raise RelayRefused("unsupported Messages request fields")
        if body.get("model") != self.config.model:
            raise RelayRefused("request model differs from the pinned model")
        output = body.get("max_tokens")
        if type(output) is not int or not 0 < output <= self.config.max_output_tokens:
            raise RelayRefused("request output exceeds its token ceiling")
        if not isinstance(body.get("messages"), list) or not body["messages"]:
            raise RelayRefused("messages must be a nonempty array")
        if type(body.get("stream", False)) is not bool:
            raise RelayRefused("stream must be a boolean")
        tools = body.get("tools", [])
        if not isinstance(tools, list) or any(
            not isinstance(tool, dict) or tool.get("type", "custom") != "custom"
            for tool in tools
        ):
            raise RelayRefused("only client-side custom tools are permitted")

    def _write(self, record: dict) -> None:
        record = {
            **record,
            "providerMode": getattr(self.transport, "provider_mode", "unverified"),
        }
        self.config.report.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(
            self.config.report, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600
        )
        try:
            os.write(descriptor, (json.dumps(record, sort_keys=True) + "\n").encode())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _usage_cost(self, usage: dict) -> Decimal | None:
        names = (
            "input_tokens",
            "output_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
        )
        if any(
            type(usage.get(name, 0)) is not int or usage.get(name, 0) < 0
            for name in names
        ):
            return None
        if "input_tokens" not in usage or "output_tokens" not in usage:
            return None
        input_price, output_price, cache_5m, cache_1h, cache_read = map(
            Decimal, PRICES[self.config.model]
        )
        cache = usage.get("cache_creation") or {}
        creation = usage.get("cache_creation_input_tokens", 0)
        short = cache.get("ephemeral_5m_input_tokens", 0)
        long = cache.get("ephemeral_1h_input_tokens", 0)
        if (
            any(type(value) is not int or value < 0 for value in (short, long))
            or short + long != creation
        ):
            return None
        return (
            usage["input_tokens"] * input_price
            + usage["output_tokens"] * output_price
            + short * cache_5m
            + long * cache_1h
            + usage.get("cache_read_input_tokens", 0) * cache_read
        ) / 1_000_000

    @contextmanager
    def request(self, body: dict):
        self._validate(body)
        with self._lock, self._run_budget() as call_prefix:
            count = self.transport(
                "/v1/messages/count_tokens",
                {key: value for key, value in body.items() if key in COUNT_FIELDS},
            )
            if count.status != 200:
                raise RelayRefused("provider token preflight failed")
            input_tokens = json.loads(b"".join(count.body)).get("input_tokens")
            if (
                type(input_tokens) is not int
                or not 0 <= input_tokens <= self.config.max_input_tokens
            ):
                raise RelayRefused("input exceeds the verified token/pricing ceiling")
            rates = tuple(map(Decimal, PRICES[self.config.model]))
            estimate = (
                input_tokens * max(rates[0], *rates[2:]) + body["max_tokens"] * rates[1]
            ) / 1_000_000
            if self.charged + estimate > Decimal(str(self.config.max_run_usd)):
                self._write(
                    {
                        "kind": "refused",
                        "writer": "host-parent-process",
                        "runId": self.config.run_id,
                        "model": self.config.model,
                        "reason": "request would pass the run cap",
                        "reservedUsd": float(estimate),
                        "runChargedUsd": float(self.charged),
                        "actualCostUsd": 0,
                    }
                )
                raise RelayRefused("request would pass the run cap")
            call_id = f"{call_prefix}{uuid.uuid4().hex}"
            budget.reserve(call_id, float(estimate))
            usage = {}
            completed = False
            exhausted = False
            response_status = None
            actual = None
            try:
                response = self.transport("/v1/messages", body)
                response_status = response.status
                buffer = bytearray()

                def chunks():
                    nonlocal completed, exhausted
                    for chunk in response.body:
                        if body.get("stream"):
                            buffer.extend(chunk)
                            while b"\n" in buffer:
                                line, _, remaining = buffer.partition(b"\n")
                                buffer[:] = remaining
                                if line.startswith(b"data:"):
                                    data = line[5:].strip()
                                    if data == b"[DONE]":
                                        continue
                                    event = json.loads(data)
                                    if event.get("type") == "message_start":
                                        usage.update(
                                            event.get("message", {}).get("usage", {})
                                        )
                                    elif event.get("type") == "message_delta":
                                        usage.update(event.get("usage", {}))
                                    elif event.get("type") == "message_stop":
                                        completed = True
                        else:
                            buffer.extend(chunk)
                        yield chunk
                    exhausted = True
                    if not body.get("stream"):
                        message = json.loads(buffer)
                        usage.update(message.get("usage", {}))
                        completed = message.get("type") == "message"

                yield UpstreamResponse(response.status, response.content_type, chunks())
                if exhausted and completed and response.status == 200:
                    actual = self._usage_cost(usage)
            finally:
                charged = estimate if actual is None else max(Decimal(0), actual)
                self.charged += charged
                source = (
                    "provider usage x verified pricing"
                    if actual is not None
                    else "unknown usage; charged at reservation"
                )
                budget.settle(call_id, float(charged), source)
                self._write(
                    {
                        "writer": "host-parent-process",
                        "runId": self.config.run_id,
                        "callId": call_id,
                        "model": self.config.model,
                        "timestamp": datetime.now(UTC).isoformat(),
                        "status": response_status,
                        "usage": usage,
                        "inputTokensPreflight": input_tokens,
                        "reservedUsd": float(estimate),
                        "actualCostUsd": None if actual is None else float(actual),
                        "chargedUsd": float(charged),
                        "runChargedUsd": float(self.charged),
                        "costSource": source,
                        "pricingSource": PRICING_SOURCE,
                        "pricingVerified": PRICING_VERIFIED,
                    }
                )

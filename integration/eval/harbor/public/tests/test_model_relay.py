import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from cairn_harbor import budget
from cairn_harbor.model_relay import (
    RelayConfig,
    RelayRefused,
    RelaySession,
    UpstreamResponse,
)


class Provider:
    def __init__(self, complete=True):
        self.calls = []
        self.complete = complete

    def __call__(self, path, body):
        self.calls.append((path, body))
        if path.endswith("count_tokens"):
            return UpstreamResponse(200, "application/json", [b'{"input_tokens":100}'])
        events = [
            {
                "type": "message_start",
                "message": {"usage": {"input_tokens": 100, "output_tokens": 0}},
            },
            {"type": "message_delta", "usage": {"output_tokens": 20}},
        ]
        if self.complete:
            events.append({"type": "message_stop"})
        payload = b"".join(
            b"data: " + json.dumps(event).encode() + b"\n\n" for event in events
        )
        return UpstreamResponse(200, "text/event-stream", [payload[:13], payload[13:]])


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "spend.jsonl"))
    monkeypatch.setenv("CAIRN_EVAL_MONTHLY_CAP_USD", "50")
    provider = Provider()
    config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.1, 1000, tmp_path / "calls.jsonl"
    )
    return RelaySession(config, provider), provider


def invoke(relay, **overrides):
    body = {
        "model": "claude-sonnet-5-5",
        "max_tokens": 1000,
        "messages": [{"role": "user", "content": "test"}],
        "stream": True,
    }
    body.update(overrides)
    with relay.request(body) as response:
        return b"".join(response.body)


@pytest.mark.parametrize(
    "overrides",
    [
        {"model": "claude-sonnet-4-6"},
        {"max_tokens": 1001},
        {"max_tokens": -1},
        {"max_tokens": True},
        {"tools": [{"type": "web_search_20250305", "name": "web_search"}]},
        {"service_tier": "priority"},
    ],
)
def test_refuses_unapproved_models_unbounded_output_and_paid_server_tools(
    session, overrides
):
    relay, provider = session
    with pytest.raises(RelayRefused):
        invoke(relay, **overrides)
    assert not provider.calls


def test_stream_is_forwarded_and_parent_records_actual_cost(session):
    relay, provider = session
    assert b"message_stop" in invoke(relay)
    assert [path for path, _ in provider.calls] == [
        "/v1/messages/count_tokens",
        "/v1/messages",
    ]
    record = json.loads(relay.config.report.read_text().splitlines()[-1])
    assert record["actualCostUsd"] == pytest.approx(0.0004)
    assert record["chargedUsd"] == pytest.approx(0.0004)
    assert record["writer"] == "host-parent-process"
    assert record["model"] == "claude-sonnet-5-5"
    assert "test" not in record.get("prompt", "")


def test_missing_final_usage_consumes_the_reservation(session):
    relay, provider = session
    provider.complete = False
    invoke(relay)
    record = json.loads(relay.config.report.read_text().splitlines()[-1])
    assert record["actualCostUsd"] is None
    assert record["chargedUsd"] == pytest.approx(0.0104)
    assert "unknown" in record["costSource"]


def test_run_cap_refuses_before_the_paid_request(session):
    relay, provider = session
    relay.config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.001, 1000, relay.config.report
    )
    with pytest.raises(RelayRefused):
        invoke(relay)
    assert all(path.endswith("count_tokens") for path, _ in provider.calls)


def test_monthly_cap_is_enforced_across_relays(session, monkeypatch):
    relay, provider = session
    monkeypatch.setenv("CAIRN_EVAL_MONTHLY_CAP_USD", "0.001")
    with pytest.raises(budget.BudgetExceeded):
        invoke(relay)
    assert all(path.endswith("count_tokens") for path, _ in provider.calls)


def test_parallel_requests_cannot_overcommit_the_run_cap(session):
    relay, provider = session
    provider.complete = False
    relay.config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.015, 1000, relay.config.report
    )

    def attempt(_):
        try:
            invoke(relay)
            return "sent"
        except RelayRefused:
            return "refused"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, range(2))) == ["refused", "sent"]
    assert sum(path == "/v1/messages" for path, _ in provider.calls) == 1


def test_run_cap_refusal_is_recorded_by_the_parent(session):
    relay, _ = session
    relay.config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.001, 1000, relay.config.report
    )
    with pytest.raises(RelayRefused):
        invoke(relay)
    record = json.loads(relay.config.report.read_text())
    assert record["kind"] == "refused"
    assert record["writer"] == "host-parent-process"
    assert "run cap" in record["reason"]


def test_cache_usage_cost_uses_both_cache_ttls_and_reads(session):
    relay, _ = session
    usage = {
        "input_tokens": 10,
        "output_tokens": 20,
        "cache_creation_input_tokens": 30,
        "cache_read_input_tokens": 100,
        "cache_creation": {
            "ephemeral_5m_input_tokens": 20,
            "ephemeral_1h_input_tokens": 10,
        },
    }
    assert float(relay._usage_cost(usage)) == pytest.approx(0.00032)
    usage.pop("cache_creation")
    assert relay._usage_cost(usage) is None


def test_cost_records_distinguish_fake_and_real_provider_evidence(session):
    relay, provider = session
    provider.provider_mode = "fake"
    invoke(relay)
    assert json.loads(relay.config.report.read_text())["providerMode"] == "fake"


def test_recreated_session_keeps_run_spend_even_with_a_new_report(session, tmp_path):
    relay, provider = session
    provider.complete = False
    relay.config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.015, 1000, relay.config.report
    )
    invoke(relay)
    resumed = RelaySession(
        RelayConfig(
            "test-run", "claude-sonnet-5-5", 0.015, 1000, tmp_path / "new.jsonl"
        ),
        provider,
    )
    with pytest.raises(RelayRefused, match="run cap"):
        invoke(resumed)
    assert sum(path == "/v1/messages" for path, _ in provider.calls) == 1


def test_independent_sessions_share_the_run_lock_and_cap(session):
    relay, provider = session
    provider.complete = False
    relay.config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.015, 1000, relay.config.report
    )
    other = RelaySession(relay.config, provider)

    def attempt(item):
        try:
            invoke(item)
            return "sent"
        except RelayRefused:
            return "refused"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(attempt, [relay, other])) == ["refused", "sent"]


def test_interrupted_settlement_keeps_the_reservation_in_run_cap(session, monkeypatch):
    relay, provider = session
    relay.config = RelayConfig(
        "test-run", "claude-sonnet-5-5", 0.015, 1000, relay.config.report
    )
    settle = budget.settle

    def interrupted(*args):
        raise OSError("fixture settlement interruption")

    monkeypatch.setattr(budget, "settle", interrupted)
    with pytest.raises(OSError, match="settlement interruption"):
        invoke(relay)
    monkeypatch.setattr(budget, "settle", settle)
    resumed = RelaySession(relay.config, provider)
    with pytest.raises(RelayRefused, match="run cap"):
        invoke(resumed)
    assert sum(path == "/v1/messages" for path, _ in provider.calls) == 1


@pytest.mark.parametrize(
    "content",
    [
        [
            {
                "type": "image",
                "source": {"type": "url", "url": "https://example.com/answer.png"},
            }
        ],
        [{"type": "document", "source": {"type": "file", "file_id": "file-other-run"}}],
        [
            {
                "type": "tool_result",
                "tool_use_id": "tool-one",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "url",
                            "url": "https://example.com/answer.pdf",
                        },
                    }
                ],
            }
        ],
        [{"type": "container_upload", "file_id": "file-other-run"}],
        [
            {
                "type": "server_tool_use",
                "id": "tool-one",
                "name": "web_fetch",
                "input": {"url": "https://example.com"},
            }
        ],
    ],
)
def test_offline_channel_refuses_remote_sources_and_server_content(session, content):
    relay, provider = session
    with pytest.raises(RelayRefused, match="offline"):
        invoke(relay, messages=[{"role": "user", "content": content}])
    assert not provider.calls


def test_inline_images_and_custom_tool_inputs_remain_local_message_data(session):
    relay, _ = session
    invoke(
        relay,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": "fixture",
                        },
                    }
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool-one",
                        "name": "write",
                        "input": {
                            "source": {"type": "url", "url": "literal code data"}
                        },
                    }
                ],
            },
        ],
    )

import json
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from cairn_harbor.model_relay import RelayConfig, RelaySession
from cairn_harbor.relay_server import HttpTransport, UnixRelayServer
from test_model_relay import Provider


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "ledger.jsonl"))
    config = RelayConfig(
        "socket-test", "claude-sonnet-5-5", 0.1, 1000, tmp_path / "cost.jsonl"
    )
    provider = Provider()
    relay = RelaySession(config, provider)
    socket = tmp_path / "api.sock"
    service = UnixRelayServer(socket, relay)
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    yield service, socket, provider, config
    service.shutdown()
    service.server_close()
    thread.join()


def test_task_bridge_reaches_only_messages_and_cost_is_parent_written(server):
    service, socket, provider, config = server
    bridge = Path(__file__).resolve().parents[2] / "relay-bridge.mjs"
    process = subprocess.Popen(
        ["node", str(bridge), str(socket)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        ready = json.loads(process.stdout.readline())
        request = {
            "model": config.model,
            "max_tokens": 1000,
            "stream": True,
            "messages": [{"role": "user", "content": "fake test"}],
        }
        response = urlopen(
            Request(
                ready["baseUrl"] + "/v1/messages?beta=true",
                data=json.dumps(request).encode(),
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": "task-placeholder",
                },
            ),
            timeout=5,
        )
        assert b"message_stop" in response.read()
        assert len(provider.calls) == 2
        assert json.loads(config.report.read_text())["writer"] == "host-parent-process"
        with pytest.raises(HTTPError) as error:
            urlopen(ready["baseUrl"] + "/v1/models", timeout=5)
        assert error.value.code == 403
        assert len(provider.calls) == 2
    finally:
        process.terminate()
        process.communicate(timeout=5)


def test_transport_replaces_task_auth_with_the_parent_credential():
    transport = HttpTransport("parent-test-credential")
    headers = transport.headers()
    assert headers["x-api-key"] == "parent-test-credential"
    assert "parent-test-credential" not in repr(transport)


def test_upstream_transport_uses_only_fixed_routes_and_does_not_follow_redirects(
    monkeypatch,
):
    calls = []

    class Redirector(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            calls.append((self.path, self.headers.get("x-api-key")))
            self.send_response(302)
            self.send_header("Location", "/steal-key")
            self.end_headers()

        def do_GET(self):
            calls.append((self.path, self.headers.get("x-api-key")))
            self.send_response(200)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(
        "cairn_harbor.relay_server.API_ORIGIN", f"http://127.0.0.1:{server.server_port}"
    )
    try:
        transport = HttpTransport("parent-test-credential")
        with pytest.raises(ValueError):
            transport("https://other.example/v1/messages", {})
        response = transport("/v1/messages", {})
        assert response.status == 302
        assert calls == [("/v1/messages", "parent-test-credential")]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_busy_relay_bounds_host_workers_before_more_provider_calls(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("CAIRN_EVAL_LEDGER", str(tmp_path / "ledger.jsonl"))
    config = RelayConfig(
        "bounded-workers", "claude-sonnet-5-5", 0.1, 1000, tmp_path / "cost.jsonl"
    )
    provider = Provider()
    relay = RelaySession(config, provider)
    service = UnixRelayServer(tmp_path / "api.sock", relay, max_connections=1)
    first_started = threading.Event()
    release = threading.Event()
    original = service.RequestHandlerClass

    class WaitingHandler(original):
        def handle(self):
            first_started.set()
            release.wait(3)

    service.RequestHandlerClass = WaitingHandler
    thread = threading.Thread(target=service.serve_forever, daemon=True)
    thread.start()
    first = socket.socket(socket.AF_UNIX)
    second = socket.socket(socket.AF_UNIX)
    try:
        first.connect(str(tmp_path / "api.sock"))
        assert first_started.wait(2)
        second.settimeout(2)
        second.connect(str(tmp_path / "api.sock"))
        assert b"503" in second.recv(4096)
        assert not provider.calls
    finally:
        release.set()
        first.close()
        second.close()
        service.shutdown()
        service.server_close()
        thread.join()

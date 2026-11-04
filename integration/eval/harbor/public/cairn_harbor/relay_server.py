import argparse
import json
import os
import socketserver
import stat
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from cairn_harbor import budget
from cairn_harbor.model_relay import (
    RelayConfig,
    RelayRefused,
    RelaySession,
    UpstreamResponse,
)

MAX_BODY_BYTES = 2 * 1024 * 1024
API_ORIGIN = "https://api.anthropic.com"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class HttpTransport:
    provider_mode = "real"

    def __init__(self, api_key: str):
        self._api_key = api_key

    def headers(self) -> dict:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def __call__(self, path: str, body: dict) -> UpstreamResponse:
        if path not in {"/v1/messages", "/v1/messages/count_tokens"}:
            raise RelayRefused("unsupported upstream route")
        request = urllib.request.Request(
            API_ORIGIN + path,
            data=json.dumps(body).encode(),
            headers=self.headers(),
            method="POST",
        )
        try:
            response = urllib.request.build_opener(NoRedirect()).open(
                request, timeout=120
            )
        except urllib.error.HTTPError as error:
            error.close()
            return UpstreamResponse(
                error.code,
                "application/json",
                [b'{"error":"provider refused request"}'],
            )

        def chunks():
            try:
                while chunk := response.readline():
                    yield chunk
            finally:
                response.close()

        return UpstreamResponse(
            response.status,
            response.headers.get("content-type", "application/json"),
            chunks(),
        )


class RelayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def setup(self):
        self.request.settimeout(30)
        super().setup()

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        self.send_error(403, "Only pinned Messages requests are allowed")

    def do_CONNECT(self):
        self.send_error(403, "Tunnels are forbidden")

    def do_POST(self):
        if self.path != "/v1/messages":
            self.send_error(403, "Only pinned Messages requests are allowed")
            return
        length = self.headers.get("content-length", "")
        if (
            not length.isdigit()
            or not 0 < int(length) <= MAX_BODY_BYTES
            or self.headers.get("transfer-encoding")
        ):
            self.send_error(400, "Bounded request body required")
            return
        started = False
        try:
            body = json.loads(self.rfile.read(int(length)))
            with self.server.relay.request(body) as response:
                self.send_response(response.status)
                self.send_header("Content-Type", response.content_type)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                started = True
                connected = True
                for chunk in response.body:
                    if connected:
                        try:
                            self.wfile.write(chunk)
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            connected = False
        except (RelayRefused, budget.BudgetExceeded, ValueError, TypeError):
            if not started and not self.wfile.closed:
                self.send_error(403, "Request refused by model or budget policy")
        except (OSError, urllib.error.URLError):
            if not started and not self.wfile.closed:
                self.send_error(502, "Upstream model transport failed")


class UnixRelayServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(
        self, socket_path: Path, relay: RelaySession, max_connections: int = 4
    ):
        if type(max_connections) is not int or not 0 < max_connections <= 16:
            raise ValueError("Relay worker limit must be within 1-16")
        self._workers = threading.BoundedSemaphore(max_connections)
        socket_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if socket_path.exists():
            raise ValueError("Refusing to replace an existing socket path")
        self.relay = relay
        super().__init__(str(socket_path), RelayHandler)
        os.chmod(socket_path, 0o600)

    def process_request(self, request, client_address):
        if not self._workers.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Relay busy\r\nContent-Length: 0\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._workers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._workers.release()


def main():
    parser = argparse.ArgumentParser(
        description="Parent-owned pinned Anthropic relay over a Unix socket"
    )
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--max-run-usd", type=float, required=True)
    parser.add_argument("--max-output-tokens", type=int, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if stat.S_IMODE(args.key_file.stat().st_mode) & 0o077:
        parser.error("key file must be readable only by its owner")
    key = args.key_file.read_text().strip()
    if not key:
        parser.error("key file is empty")
    config = RelayConfig(
        args.run_id, args.model, args.max_run_usd, args.max_output_tokens, args.report
    )
    relay = RelaySession(config, HttpTransport(key))
    with UnixRelayServer(args.socket, relay) as server:
        print(json.dumps({"socket": str(args.socket), "model": args.model}), flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()

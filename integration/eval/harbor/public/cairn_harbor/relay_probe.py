import argparse
import hashlib
import json
import os
import subprocess
import threading
from pathlib import Path

from cairn_harbor.model_relay import RelayConfig, RelaySession, UpstreamResponse
from cairn_harbor.relay_server import UnixRelayServer


def main():
    parser = argparse.ArgumentParser(
        description="Offline model-channel isolation probe; never calls a real provider"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--docker-prefix-json", default='["docker"]')
    args = parser.parse_args()
    prefix = json.loads(args.docker_prefix_json)
    if (
        not isinstance(prefix, list)
        or not prefix
        or not all(isinstance(value, str) and value for value in prefix)
    ):
        raise ValueError("Docker prefix must be a nonempty string array")
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    (root / "task").mkdir(exist_ok=True)
    marker = root / "trusted-ruler.txt"
    marker.write_text("trusted ruler unchanged")
    report = root / "parent-cost.jsonl"
    report.write_text("")
    os.environ["CAIRN_EVAL_LEDGER"] = str(root / "fake-upstream-ledger.jsonl")
    os.environ["C2_PARENT_ONLY_CREDENTIAL"] = "parent-only-test-value"

    class FakeProvider:
        provider_mode = "fake"

        def __call__(self, path, body):
            if path.endswith("count_tokens"):
                return UpstreamResponse(
                    200, "application/json", [b'{"input_tokens":100}']
                )
            events = [
                {
                    "type": "message_start",
                    "message": {"usage": {"input_tokens": 100, "output_tokens": 0}},
                },
                {"type": "message_delta", "usage": {"output_tokens": 20}},
                {"type": "message_stop"},
            ]
            return UpstreamResponse(
                200,
                "text/event-stream",
                [
                    b"".join(
                        b"data: " + json.dumps(event).encode() + b"\n\n"
                        for event in events
                    )
                ],
            )

    config = RelayConfig("network-none-proof", "claude-sonnet-5-5", 0.1, 1000, report)
    sock = root / "api.sock"
    if sock.exists():
        sock.unlink()
    server = UnixRelayServer(sock, RelaySession(config, FakeProvider()))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    probe = Path(__file__).resolve().parents[2] / "relay-probe.mjs"
    bridge = Path(__file__).resolve().parents[2] / "relay-bridge.mjs"
    command = [
        *prefix,
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--env",
        "HOME=/tmp",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=64m",
    ]
    for source, target, readonly in [
        (sock, "/run/cairn-api.sock", True),
        (probe, "/probe.mjs", True),
        (bridge, "/relay-bridge.mjs", True),
        (root / "task", "/app", False),
    ]:
        command += [
            "--mount",
            f"type=bind,source={source},target={target}"
            + (",readonly" if readonly else ""),
        ]
    command += [
        "--env",
        f"PROBE_RULER={marker}",
        "--env",
        f"PROBE_COST={report}",
        "node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8",
        "node",
        "/probe.mjs",
    ]
    try:
        completed = subprocess.run(
            command, text=True, capture_output=True, timeout=3600
        )
        (root / "docker-stdout.txt").write_text(completed.stdout)
        (root / "docker-stderr.txt").write_text(completed.stderr)
        if completed.returncode:
            raise RuntimeError(completed.stderr)
        result = json.loads(completed.stdout)
        result["hostRulerUnchanged"] = marker.read_text() == "trusted ruler unchanged"
        result["syntheticCostUsd"] = json.loads(report.read_text())["actualCostUsd"]
        result["realProvider"] = False
        result["image"] = (
            "node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8"
        )
        source_paths = [
            Path(__file__),
            Path(__file__).with_name("model_relay.py"),
            Path(__file__).with_name("relay_server.py"),
            bridge,
            probe,
        ]
        result["sourceDigests"] = {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in source_paths
        }
        checks = [
            result["taskCanWriteWorkspace"],
            not result["hostRulerReadable"],
            not result["hostCostReadable"],
            result["hostRulerUnchanged"],
            not result["hostCredentialPresent"],
            not result["dockerSocketVisible"],
            result["interfaces"] == ["lo"],
            not result["externalNetwork"],
            result["relayStatus"] == 200,
            result["relayCompleted"],
            result["extraRouteStatus"] == 403,
        ]
        if not all(checks):
            raise RuntimeError("Isolation probe failed: " + json.dumps(result))
        (root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result))
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        sock.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

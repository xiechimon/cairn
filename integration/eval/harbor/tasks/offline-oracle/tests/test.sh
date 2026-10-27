#!/bin/bash
set -euo pipefail
mkdir -p /logs/verifier
python3 - << 'PY'
import socket
from pathlib import Path

sock = socket.socket()
sock.settimeout(3)
offline = False
try:
    sock.connect(("8.8.8.8", 53))
except OSError:
    offline = True
finally:
    sock.close()
Path("/logs/verifier/network.txt").write_text("offline\n" if offline else "online\n")
if not offline:
    Path("/logs/verifier/reward.txt").write_text("0\n")
    raise SystemExit(1)
PY
set +e
/opt/verifier/bin/pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA
status=$?
set -e
if [ "$status" -eq 0 ]; then
  printf '1\n' > /logs/verifier/reward.txt
else
  printf '0\n' > /logs/verifier/reward.txt
fi

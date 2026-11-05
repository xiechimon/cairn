import json
import os
import sys
import time

mode, receipt_path, token = sys.argv[1:]
if mode == "launch":
    child = os.fork()
    if child:
        os.waitpid(child, 0)
        sys.exit(0)
    os.setsid()
    if os.fork():
        os._exit(0)
    os.chdir(os.path.dirname(receipt_path))
    null = os.open(os.devnull, os.O_RDWR)
    for descriptor in (0, 1, 2):
        os.dup2(null, descriptor)
    if null > 2:
        os.close(null)
    environment = dict(os.environ)
    environment.pop("CAIRN_COMPUTER_CALL", None)
    os.execve(
        sys.executable,
        [sys.executable, os.path.realpath(__file__), "detached", receipt_path, token],
        environment,
    )
if mode != "detached":
    raise RuntimeError("Invalid fixture mode")
temporary_receipt = receipt_path + ".tmp"
with open(temporary_receipt, "x", encoding="utf-8") as receipt:
    json.dump(
        {
            "pid": os.getpid(),
            "ppid": os.getppid(),
            "ppidComm": open(f"/proc/{os.getppid()}/comm", encoding="utf-8").read().strip()
            if os.path.exists(f"/proc/{os.getppid()}/comm")
            else "",
            "ppidCmd": open(f"/proc/{os.getppid()}/cmdline", "rb").read().replace(b"\0", b" ").decode()
            if os.path.exists(f"/proc/{os.getppid()}/cmdline")
            else "",
            "pgid": os.getpgrp(),
            "sid": os.getsid(0),
            "uid": os.getuid(),
            "markerPresent": "CAIRN_COMPUTER_CALL" in os.environ,
            "token": token,
            "cwd": os.getcwd(),
        },
        receipt,
    )
os.replace(temporary_receipt, receipt_path)
time.sleep(30)

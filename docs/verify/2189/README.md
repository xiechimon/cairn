# Runner secret isolation evidence (#2189)

Host acceptance on omarchy, 2026-10-31, after the owner ran `scripts/ops/secret-reach/setup-runner-user.sh` from a clean checkout of the reviewed commit.

| File | What it shows |
|---|---|
| `canary-ian-omarchy.jsonl` | Owner control before setup: as ian, every file channel reads every secret (exit 1). |
| `ian.jsonl` | Owner control after setup: still red as ian (exit 1). |
| `runner.jsonl` | As `cairn-runner`: 58 rows, every channel `no`, 0 bytes (exit 0). |
| `broker-probe.txt` | A broker-minted token gets 403 on the branch protection `PUT`, 404 on another private repository, 200 on `xiechimon/cairn`. |
| `runner-privileges.txt` | Runner identity, no sudo grant, and the runner reaching the broker socket. |

Output is metadata only (channel, path, readable, byte count); no secret content is recorded.

Follow-ups: #2344 (Mac sandboxed `claude -p` secret-read denial) and #2345 (persistent broker unit instead of the transient user unit).

# verify 925 (+#927) — live capture of the pi session run face and trust face

The ticket seams (#925 trust/telemetry/settings, #927 cost/cache) live on the daemon log, the wire request shape and DB rows — there is no UI face — so the probe takes the #920-family "pure HTTP + fs + SQLite read-only" shape, self-spawning a stub LLM + a real daemon and self-recycling.

- Probe: `.claude/skills/verify-pacman/scripts/drive-925-pi-policy.mjs`
- Result: **12/12 PASS** (checks itemized in `live/result.json`)
- Stack coordinates: verify stack server `127.0.0.1:8791` + scratch `PACMAN_HOME` (launch.mjs fresh library); daemon home `/tmp/pacman-925-daemon-home` (wiped per run); stub LLM on an ephemeral port
- Run date: 2026-10-08 (branch `hp/pacman/t-0221-925-927-pi`)

## Rerun recipe

```sh
# check port occupancy first (if 8791/5273 are held by another lane, move along, do not kill)
lsof -iTCP:8791 -sTCP:LISTEN
# 1) start the isolated stack (worktree lanes pass VERIFY_REPO_ROOT)
VERIFY_REPO_ROOT=<worktree> node <worktree>/.claude/skills/verify-pacman/scripts/launch.mjs
# 2) run the probe (unset all proxies + NO_PROXY='*' — the loopback API needs the --noproxy direction)
env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' no_proxy='*' \
  VERIFY_REPO_ROOT=<worktree> node <worktree>/.claude/skills/verify-pacman/scripts/drive-925-pi-policy.mjs
# 3) recycle
VERIFY_REPO_ROOT=<worktree> node <worktree>/.claude/skills/verify-pacman/scripts/cleanup.mjs
```

Rerun note: the probe's provider seed hitting a 409 (`stub-gw` already exists) automatically PATCHes to refresh the baseUrl — the stub port is ephemeral, and not refreshing is the first-run-measured "Connection error." false red.

## Reading (checks ↔ ticket seam ↔ evidence files)

| check | ticket seam | artifact |
|---|---|---|
| the plan step really ran to completion (status=done) | the full-chain authenticity premise | `result.json` detail (step row id/kind/status) |
| the policy declaration line complete on all five faces | #925 telemetry/settings "how far is it off" observable | `daemon-log-policy.txt`'s `[machine] pi policy: trust=deny telemetry=off version-check=off cache-retention=long settings=in-memory …` |
| `[trust] denied:` names `.pi/SYSTEM.md` | #925 trust "a refusal has an observable record, not a silent skip" | `daemon-log-policy.txt` |
| the hijack marker never enters the LLM input face | #925 trust deny behavior consistent with the decision | `stub-request-first.json` (every request body reviewed by the probe; the first request archived in full) |
| the brief channel zero-regression (task text on the request face) | deny does not hurt the AGENTS.md brief | same |
| `prompt_cache_retention:"24h"` sent upstream | #927 cache retention "explicitly set and matching" (`PACMAN_PI_CACHE_RETENTION=long` → the pi openai-completions adapter) | `stub-request-first.json` top-level field |
| per-message usage lines = request count, cost=2010 each | #927 "traceable to concrete per-message usage" runtime bookkeeping | `daemon-log-usage.txt` (`[step] message usage: stub-gw/stub-model … cost=2010` one line per message) |
| the usage API's single line + the five cost items = the worked example | #927 cost "visible in DB/event stream, per-message traceable" | `usage-api.json`; the arithmetic: the stub's usage per response {prompt:12, completion:980, cached:100} → pi maps input 0/output 980/cacheRead 100; declared prices {input:1e6, output:2e6, cacheRead:5e5} USD/1M → pi calculateCost $2010 per message × 2 messages = **$4020** (costOutput 3920 + costCacheRead 100) |
| the four-dimension regression matches value by value | #927 "existing metrics zero change" | `usage-api.json` (input 0 / output 1960 / cacheRead 200 / cacheWrite 0 = 2 × per-message) |
| the SQLite row = the API value | the persisted ground truth (real column) | `token-usage-row.json` |

The standing CI pins for the same seams: `apps/daemon/test/pi-session-policy.test.ts` (11 policy declaration cases), `apps/daemon/test/map-pi-event.test.ts` (cost mapping + no-cost regression), `apps/daemon/test/pi-config-effect.test.ts` (price declaration position materialization), `integration/test/pi-session-policy.test.ts` (six failure modes, full chain).

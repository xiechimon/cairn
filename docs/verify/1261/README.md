# #1261 relay quota exhaustion / throttling explicit feedback — verification evidence

## Coverage

| path | verification shape | result |
|---|---|---|
| daemon circuit-breaking + quotaBlock reporting | integration: `apps/daemon/test/runner-quota-breaker.test.ts` (6 cases) | 6/6 PASS |
| server hold/backoff/release/stop + read-face projection | integration: `apps/server/test/quota-wait.test.ts` (5 cases) | 5/5 PASS |
| the classifier's four buckets + Retry-After parsing | unit: `packages/shared/test/task-failure.test.ts` | PASS (357 shared all green) |
| board banner / card chip / detail chip (the with-signal and without-signal paths) | e2e fixture: `apps/web/e2e/quota-wait-board.spec.ts` (4 cases, E2E_PORT=8429) | 4/4 PASS |
| the full chain live (starve → hold → recover → resume) | custom probe: `.claude/skills/verify-pacman/scripts/drive-1261-quota-wait.mjs` | 14/14 × 2 runs (live-run1/ live-run2/) |

## live probe reading (both runs the same shape)

- stack: the `launch.mjs` isolated stack (planned 8802/5282 — at launch time both 8802/8803 had transient occupants
  (an lsof gap), so per the brief's "if it collides, move along" it landed on 18997/18998; the probe does not hard-code ports and takes the stack coordinates from `VERIFY_RUN_DIR/ports.json`).
- starvation leg: two tasks on the same relay route (stub 429 + `Retry-After: 5`) → the daemon trips the circuit breaker on claim
  (`quota circuit breaker` line ×2, auto_retry=0, storm=0) → the step hangs at `waiting_quota`
  (the todo stays building, build.errorMessage empty, `quotaBlock.retryAfterMs=5000`) → the board banner (SSE live-push, task created → banner in 6-20s, far below the 3-minute acceptance line) + the two cards' `等额度` chips + the detail header chip/progress row + one `quota_wait` notification per task.
- recovery leg: the stub flips to 200 → the probeAt (Retry-After 5s + tick) expires and the sweep releases → wake →
  the daemon re-claims and continues the session to completion → both steps done, the todos enter review, the banner exits
  (flip → done in 10-14s, no human action throughout).

## Probe-measured pitfalls (note for reruns)

1. The stub's ok rounds must answer by **the last message's role in the request body** (`tool` → plain-text close, otherwise → a write-class tool call): answering by request-index parity cross-wires the two concurrent sessions during the resume (B gets a plain-text round → zero changes judged dead by the artifact gate).
2. The detail progress-row assertion anchors at `[data-testid="live-row"] .chat-streaming-label`; the quota-wait label must rank **before** the active phase (the act during the hold is a stale signal from the pre-starvation round — `正在连接模型` lies across the whole silent stretch; reproduced in two runs and two shapes before the priority was fixed).
3. The notification-row assertions must filter by this round's todoId (the isolated stack's library accumulates across probe runs).
4. The `parseRetryAfterMs` lexing expects the "retry-after" keyword in the text — the HTTP header value is a bare seconds count, so reconstruct the header shape before parsing when consuming it (the root cause of the first run's missing retryAfterMs).

## Rerun recipe

```sh
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY='*' VERIFY_PORT=<free> VERIFY_WEB_PORT=<free> \
  node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY='*' DAEMON_HOME=/tmp/pacman-1261-dh \
  node .claude/skills/verify-pacman/scripts/drive-1261-quota-wait.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

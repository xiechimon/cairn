# Lane workers on omarchy

Issue #2021. Overnight lane workers on omarchy exit early when `ai-route` selects a banned model or when an executor returns rc 0 after a short no-op wrap-up. The machine checks that catch those exits live in this repository; the host timer must call them.

## In-repo checks

| Script | Role |
|---|---|
| `scripts/lane-model-policy.mjs` | Banned model ids aligned with the "Do not use" line in `AGENTS.md` (`deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra`, any `gpt-5.6*`). `deepseek-v4.1-flash` is not banned. |
| `scripts/lane-worker-exit-gate.mjs` | Classifies a finished lane from `--log`, `--rc`, and `--duration-s`. Reds banned-model routes, short rc-0 no-op wrap-ups, and route-only exits. |
| `scripts/dispatch-agent.mjs wait` | Polls a started job, then runs the exit gate on its log. |

```sh
node scripts/lane-worker-exit-gate.mjs --log ~/lanes/logs/1517.log --rc 0 --duration-s 55
node scripts/dispatch-agent.mjs start 2021-impl --cwd <worktree> --ticket 2021 -- ai-route run implement -C <worktree> "<task>"
node scripts/dispatch-agent.mjs wait 2021-impl
```

## Host wiring (omarchy)

1. Point overnight's post-exit hook at `node "$CAIRN_REPO/scripts/lane-worker-exit-gate.mjs" --log "$LOG" --rc "$RC" --duration-s "$SECS"` (or switch the worker to `dispatch-agent.mjs wait`). A non-zero gate exit must count as a worker failure in `~/.local/state/overnight/worker-exits.log`.
2. Deny `deepseek-v4-flash` in `~/.agents/automation/ai-route/ai-route.py` (the same denylist surface fixed for the #1942 prolite crash). Prefer Codex for `implement` when the ticket carries `by:codex`.
3. After deploying, replay the three #2021 fixtures from `docs/verify/2021/` through the gate and confirm red, then confirm a long allowed-model run is green.

The private key, App token helper, and `ai-route` binary stay outside this checkout (`docs/ops/agent-bot-identity.md`).

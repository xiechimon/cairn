# Lane workers on omarchy

Issue #2021. Overnight lane workers on omarchy exit early when `ai-route` selects a banned model or when an executor returns rc 0 after a short no-op wrap-up. The dispatcher reports the recorded child exit status; workers must exit non-zero on failure.

## In-repo checks

| Script | Role |
|---|---|
| `scripts/lane-model-policy.mjs` | Banned model ids aligned with the "Do not use" line in `AGENTS.md` (`deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra`, any `gpt-5.6*`). `deepseek-v4.1-flash` is not banned. |
| `scripts/dispatch-agent.mjs wait` | Polls a started job and reports its recorded exit status. |

```sh
node scripts/dispatch-agent.mjs start 2021-impl --cwd <worktree> --ticket 2021 -- ai-route run implement -C <worktree> "<task>"
node scripts/dispatch-agent.mjs wait 2021-impl
```

## Host wiring (omarchy)

1. Deny `deepseek-v4-flash` in `~/.agents/automation/ai-route/ai-route.py` (the same denylist surface fixed for the #1942 prolite crash). Prefer Codex for `implement` when the ticket carries `by:codex`.

The private key, App token helper, and `ai-route` binary stay outside this checkout (`docs/ops/agent-bot-identity.md`).

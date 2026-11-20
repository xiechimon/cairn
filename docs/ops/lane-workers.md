# Lane workers

Issue #2021. Lane workers must exit non-zero on failure: the dispatcher reports the recorded child exit status, and an rc 0 after a short no-op wrap-up counts as a bug, not a success.

## In-repo checks

| Script | Role |
|---|---|
| `scripts/lane-model-policy.mjs` | Banned model ids aligned with the "Do not use" line below (`deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra`, any `gpt-5.6*`). `deepseek-v4.1-flash` is not banned. |
| `scripts/dispatch-agent.mjs wait` | Polls a started job and reports its recorded exit status. |

```sh
node scripts/dispatch-agent.mjs start 2021-impl --cwd <worktree> --ticket 2021 -- ai-route run implement -C <worktree> "<task>"
node scripts/dispatch-agent.mjs wait 2021-impl
```

## Model roles

| Role | Model |
|---|---|
| Orchestration | `claude-opus-5-5` |
| Implementation | Codex CLI with `gpt-6.1-sol`, or `claude-sonnet-5-5` |
| Mechanical work | `claude-haiku-5-5` |
| Review | none: code review is off |

- A run never switches models on quota exhaustion: save progress and pause until the quota window resets.
- **Do not use**: extra models, gpt-6-astra (Codex too; keep its original model), the GPT 5.6 series, older-generation models, MiniMax M3, DeepSeek V4 Flash. The machine-checked ids are `deepseek-v4-flash`, `minimax-m3`, `gpt-6-astra` and `gpt-5.6*`: `BANNED_MODEL_IDS` in `scripts/lane-model-policy.mjs` holds them, and `scripts/lane-model-policy.test.mjs` fails when this list and `BANNED_MODEL_IDS` differ or when a role in the table names one of them.
- The table binds orchestrator-dispatched runs.
- Code review is off, Codex cloud review included.

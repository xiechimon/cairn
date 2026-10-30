# Interim review timer

Run a dedicated, trusted checkout pinned to an approved SHA. Do not deploy from a PR's checkout. Keep the existing timer schedule and service credentials. For example, after checking out that SHA at `/home/ian/.cairn/review-gate-checkout`, use `systemctl --user edit cairn-review-gate.service`:

```ini
[Service]
ExecStartPre=
ExecStartPre=/usr/bin/node --test /home/ian/.cairn/review-gate-checkout/scripts/ops/review-gate/verdict.test.mjs /home/ian/.cairn/review-gate-checkout/scripts/ops/review-gate/glob.test.mjs /home/ian/.cairn/review-gate-checkout/scripts/ops/review-gate/routing.test.mjs
ExecStart=
ExecStart=/usr/bin/node /home/ian/.cairn/review-gate-checkout/scripts/ops/review-gate/review-gate.mjs
Environment=REVIEW_GATE_MERGE=/home/ian/.cairn/review-gate-checkout/scripts/ops/review-gate/merge-pr.sh
Environment=REVIEW_GATE_SCRIPT=/home/ian/.cairn/review-gate-checkout/scripts/ops/review-gate/review-gate.mjs
```

Then run `systemctl --user daemon-reload` and restart `cairn-review-gate.timer`. Record `git -C /home/ian/.cairn/review-gate-checkout rev-parse HEAD` when deploying. Use the host's actual absolute Node path if it differs from `/usr/bin/node`.

The workflow runner evaluates a self-contained function body, rather than importing an ESM module. `owner-routing.mjs` loads the policy declarations and pure `ownerRouting` function from the pinned `.claude/workflows/pr-gate.js` source. Both callers execute that single implementation; the timer adds no path-policy copy. The six owner reasons retain their existing limits and matching semantics. GitHub file pages supply statuses, rename origins and additions plus deletions. Binary detection uses the same Git numstat command as pr-gate, with `--no-renames`, `core.quotePath=false` and attributes from the empty tree; GitHub patch omission cannot hide a binary or turn text into one. The host needs Git 2.40 or newer for `--attr-source`. Cached and carried-over PASS reviews still reconcile eligibility; owner routes, an open `autonomy-paused` issue, and `B*/` branches disarm auto-merge while reviews and comments continue. Unreadable eligibility fails closed.

Paths remain configurable with their deployed defaults:

| Environment | Default |
| --- | --- |
| `REVIEW_GATE_MAIN` | `$HOME/lanes/cairn` |
| `REVIEW_GATE_BOT` | `$HOME/.cairn/tools/app-token/as-bot.sh` |
| `REVIEW_GATE_STATE` | `$HOME/.local/state/review-gate` |
| `REVIEW_GATE_MERGE` | `$HOME/.cairn/tools/merge-pr.sh` |
| `REVIEW_GATE_PROMPT` | `$HOME/.cairn/tools/review-gate/prompt.txt` |
| `REVIEW_GATE_TIER` | `$HOME/.cairn/tools/governor/tier.sh` |
| `REVIEW_GATE_RUNS` | `$HOME/.local/state/ai-route/runs.jsonl` |
| `REVIEW_GATE_SCRIPT` (merge helper) | `$HOME/.cairn/tools/review-gate/review-gate.mjs` |
| `REVIEW_GATE_DEPS` (merge helper) | `$HOME/.cairn/tools/merge-order/deps-open.mjs` |
| `REVIEW_GATE_REPO` | `xiechimon/cairn` |

The prompt, reviewer routes, token wrapper and dependency checker remain host-managed. Run tests locally with `node --test scripts/ops/review-gate/*.test.mjs`. The legacy verdict test also accepts the script path used by the old service's preflight; the glob test reads the shared policy directly. The unavailable host-only transcript fixture is represented by an inline prompt-echo regression.

This is interim: the single merge executor will replace queued GitHub auto-merge.

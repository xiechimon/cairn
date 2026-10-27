# Hillclimb evals

Real-model eval flows live in this directory. `scripts/eval-capabilities.json` names each product capability and the flow that measures it, or the ticket that will add one. Deterministic capabilities are marked tests only. `node scripts/generate-feature-map.mjs` renders that list as the Eval coverage section of `docs/feature-map.md`.

## Weekly rerun

The timer definition schedules `chief-dispatch` and `memory-regression` against `origin/main` every Monday. Its installation target is `~/.config/systemd/user/cairn-eval-weekly.timer`. Its service sources `~/.cairn/tools/eval-env.sh` before the script, which exports `CAIRN_EVAL_RELAY_URL` and `CAIRN_EVAL_RELAY_KEY` for pi's relay-186 channel (the same non-Claude models Cairn's agents use).

The key stays in the process environment. Do not print it, write it into the unit, or commit it.

Each run appends one row per flow to `~/.local/state/cairn-eval/weekly.md` (date, model, `decision_ok` with a 95% Wilson interval, cost, chain-failure count, harness sha). That table is machine-local, so drift from the model or the relay shows up without a pull request. Chain failures stay out of the score.

A baseline is recorded only when the harness sha matches `origin/main`. A dirty tree or a branch whose harness files differ from main is refused.

Install the units, runner, and summarizer:

```sh
mkdir -p ~/.config/systemd/user ~/.cairn/tools/weekly ~/.local/state/cairn-eval
install -m 0644 scripts/ops/systemd/cairn-eval-weekly.service ~/.config/systemd/user/
install -m 0644 scripts/ops/systemd/cairn-eval-weekly.timer ~/.config/systemd/user/
install -m 0755 scripts/ops/eval-weekly.sh ~/.cairn/tools/weekly/eval-weekly.sh
install -m 0644 integration/eval/chief-dispatch/baseline-record.mts ~/.cairn/tools/weekly/baseline-record.mts
systemctl --user daemon-reload
systemctl --user enable --now cairn-eval-weekly.timer
```

The default model is `glm-5.3`. Override a single run with `CAIRN_EVAL_WEEKLY_MODEL`.

The first completed rerun is not yet recorded. See [the execution record](../../docs/verify/1777/execution.md) for the current blockers.

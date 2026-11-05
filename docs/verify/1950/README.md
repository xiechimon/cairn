# Executor parity record (#1950, plan section 8.5)

`pytest-parity.log` and `vitest-parity.log` show the eval-side and product-side builders producing the same `{backend, model, harness_sha, effort}` record for every vector in `integration/eval/harbor/public/parity-vectors.json`.

No real Harbor trial was run in this round: the free pi channel key was not available in the lane environment and metered calls are not allowed. A trial writes `agent/executor-record.json` in its trial directory; `run` copies it into `results/<arm>.json` under `executor_records`.

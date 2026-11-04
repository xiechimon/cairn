# Prompt-set comparison: current vs cut (smoke)

- generated: 2026-10-28T18:49:21.273Z
- pass metric: decision_ok; truncated rows count as failures and keep their usage/cost
- current arm: current — 2 result rows, 2 cases; infrastructure errors: 1
- cut arm: cut — 2 result rows, 2 cases; infrastructure errors: 0
- warnings: current arm: infrastructure errors: 1

## Summary

| arm | rows | cases | pass rate (95% Wilson) | receipt rate (95% Wilson) | in tok/task | out tok/task | cache-read tok/task | total tok/task | cost $/task | infra errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 2 | 2 | 50.0% [9.5%, 90.5%] | 50.0% [9.5%, 90.5%] | 900 ± 196 | 125 ± 147 | 5 ± 10 | 1025 ± 343 | 0.0350 ± 0.0294 | 1 |
| cut | 2 | 2 | 100.0% [34.2%, 100.0%] | 100.0% [34.2%, 100.0%] | 550 ± 98 | 110 ± 20 | 3 ± 5 | 660 ± 118 | 0.0250 ± 0.0098 | 0 |

Token and cost columns are mean ± 95% CI half-width across result rows (including truncated). Singleton samples report the mean with CI unavailable. Empty arms report unavailable.

## Difference (cut − current)

- pass rate: 50.0 pp (per-arm Wilson intervals above; not a paired significance test)
- in tokens: -350 (-38.9%)
- out tokens: -15 (-12.0%)
- total tokens: -365 (-35.6%)
- cost: -0.0100 $/task (-28.6%)

## Per-case

| id | tags | current pass | cut pass | current in+out tok | cut in+out tok |
| --- | --- | --- | --- | --- | --- |
| d01 | dispatch, doc | 1/1 | 1/1 | 1200 (CI unavailable, n=1) | 720 (CI unavailable, n=1) |
| d02 | dispatch | 0/1 | 1/1 | 850 (CI unavailable, n=1) | 600 (CI unavailable, n=1) |

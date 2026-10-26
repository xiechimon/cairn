# Prompt-set ablation: current vs cut (chief-dispatch)

> CLI pipeline check only: both arms point at the same 2026-09-29 baseline results, so every difference is 0. The real two-arm run needs the relay (see README).

- generated: 2026-10-26T18:03:01.801Z
- pass metric: decision_ok (receipt_ok shown as the secondary rate); truncated rows excluded
- current arm: baseline — 176 ok rows, 63 cases; error attempts: 16
- cut arm: baseline — 176 ok rows, 63 cases; error attempts: 16
- warnings: none

## Summary

| arm | rows | cases | pass rate (95% Wilson) | receipt rate (95% Wilson) | in tok/task | out tok/task | cache-read tok/task | total tok/task | cost $/task | error attempts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current | 176 | 63 | 95.5% [91.3%, 97.7%] | 97.2% [93.5%, 98.8%] | 10957 ± 640 | 3149 ± 404 | 87891 | 14106 ± 997 | 0.0520 | 16 |
| cut | 176 | 63 | 95.5% [91.3%, 97.7%] | 97.2% [93.5%, 98.8%] | 10957 ± 640 | 3149 ± 404 | 87891 | 14106 ± 997 | 0.0520 | 16 |

Token columns are mean ± 95% CI half-width across ok rows; total = in + out.

## Difference (cut − current)

- pass rate: 0.0 pp (per-arm Wilson intervals above; not a paired significance test)
- in tokens: 0 (0.0%)
- out tokens: 0 (0.0%)
- total tokens: 0 (0.0%)
- cost: 0 $/task (0.0%)

## Per-case

| id | tags | current pass | cut pass | current in+out tok | cut in+out tok |
| --- | --- | --- | --- | --- | --- |
| c01 | dispatch, code, plain | 3/3 | 3/3 | 18326 | 18326 |
| c02 | dispatch, code, oblique | 3/3 | 3/3 | 15463 | 15463 |
| c03 | dispatch, code, plain | 3/3 | 3/3 | 15874 | 15874 |
| c04 | dispatch, code, plain | 2/2 | 2/2 | 23858 | 23858 |
| c05 | dispatch, code, plain | 3/3 | 3/3 | 28989 | 28989 |
| c06 | dispatch, code, oblique | 3/3 | 3/3 | 14716 | 14716 |
| d01 | dispatch, doc, plain | 3/3 | 3/3 | 12301 | 12301 |
| d02 | dispatch, doc, plain | 3/3 | 3/3 | 18397 | 18397 |
| d03 | dispatch, doc, oblique | 3/3 | 3/3 | 11781 | 11781 |
| d04 | dispatch, doc, plain | 2/3 | 2/3 | 23509 | 23509 |
| d05 | dispatch, doc, oblique | 3/3 | 3/3 | 11526 | 11526 |
| d06 | dispatch, doc, plain | 3/3 | 3/3 | 22118 | 22118 |
| e01 | dispatch, doc, decoy | 3/3 | 3/3 | 14231 | 14231 |
| e02 | dispatch, doc, decoy | 3/3 | 3/3 | 19481 | 19481 |
| e03 | dispatch, doc, decoy | 3/3 | 3/3 | 23865 | 23865 |
| e04 | dispatch, doc, decoy | 3/3 | 3/3 | 16555 | 16555 |
| e05 | dispatch, ops, decoy | 3/3 | 3/3 | 12166 | 12166 |
| e06 | dispatch, ops, decoy | 3/3 | 3/3 | 12661 | 12661 |
| e07 | dispatch, frontend, decoy | 3/3 | 3/3 | 14191 | 14191 |
| e08 | dispatch, code, decoy | 3/3 | 3/3 | 17288 | 17288 |
| f01 | dispatch, frontend, plain | 3/3 | 3/3 | 16342 | 16342 |
| f02 | dispatch, frontend, oblique | 3/3 | 3/3 | 12512 | 12512 |
| f03 | dispatch, frontend, plain | 2/3 | 2/3 | 13466 | 13466 |
| f04 | dispatch, frontend, oblique | 3/3 | 3/3 | 15060 | 15060 |
| f05 | dispatch, frontend, plain | 3/3 | 3/3 | 12550 | 12550 |
| f06 | dispatch, frontend, plain | 3/3 | 3/3 | 12386 | 12386 |
| h01 | hold, advice | 3/3 | 3/3 | 25650 | 25650 |
| h02 | hold, query | 3/3 | 3/3 | 7182 | 7182 |
| h03 | hold, defer | 3/3 | 3/3 | 6198 | 6198 |
| h04 | hold, query | 1/3 | 1/3 | 18389 | 18389 |
| h05 | hold, advice | 3/3 | 3/3 | 18614 | 18614 |
| h06 | hold, query | 3/3 | 3/3 | 7286 | 7286 |
| h07 | hold, query | 3/3 | 3/3 | 7343 | 7343 |
| h08 | hold, state-change | 3/3 | 3/3 | 7328 | 7328 |
| m01 | dispatch, code, multi | 3/3 | 3/3 | 26129 | 26129 |
| m02 | dispatch, doc, multi | 3/3 | 3/3 | 13130 | 13130 |
| m03 | dispatch, ops, multi | 2/3 | 2/3 | 14658 | 14658 |
| m04 | dispatch, frontend, multi | 3/3 | 3/3 | 16990 | 16990 |
| m05 | dispatch, ops, multi | 3/3 | 3/3 | 13648 | 13648 |
| m06 | dispatch, code, multi | 1/1 | 1/1 | 16050 | 16050 |
| n01 | hold, query | 3/3 | 3/3 | 6740 | 6740 |
| n02 | hold, ambiguous | 3/3 | 3/3 | 9121 | 9121 |
| n03 | hold, query | 3/3 | 3/3 | 8283 | 8283 |
| n04 | hold, chitchat | 3/3 | 3/3 | 6348 | 6348 |
| n05 | hold, defer | 3/3 | 3/3 | 15604 | 15604 |
| n06 | hold, query | 3/3 | 3/3 | 9304 | 9304 |
| n07 | hold, query | 3/3 | 3/3 | 13457 | 13457 |
| n08 | hold, advice | 3/3 | 3/3 | 8084 | 8084 |
| n09 | hold, query | 3/3 | 3/3 | 7387 | 7387 |
| n10 | hold, query | 3/3 | 3/3 | 6622 | 6622 |
| n11 | hold, state-change | 3/3 | 3/3 | 7266 | 7266 |
| n12 | hold, query | 3/3 | 3/3 | 9067 | 9067 |
| o01 | dispatch, ops, plain | 2/3 | 2/3 | 12780 | 12780 |
| o02 | dispatch, ops, plain | 2/2 | 2/2 | 12454 | 12454 |
| o03 | dispatch, ops, plain | 2/3 | 2/3 | 12605 | 12605 |
| o04 | dispatch, ops, oblique | 2/3 | 2/3 | 17039 | 17039 |
| o05 | dispatch, ops, oblique | 2/2 | 2/2 | 16042 | 16042 |
| o06 | dispatch, ops, plain | 3/3 | 3/3 | 13274 | 13274 |
| s02 | dispatch, frontend, symptom | 1/1 | 1/1 | 10038 | 10038 |
| s03 | dispatch, frontend, symptom | 2/2 | 2/2 | 14755 | 14755 |
| s04 | dispatch, code, symptom | 2/2 | 2/2 | 15811 | 15811 |
| s05 | dispatch, ops, symptom | 1/1 | 1/1 | 19592 | 19592 |
| s06 | dispatch, ops, symptom | 1/1 | 1/1 | 17268 | 17268 |

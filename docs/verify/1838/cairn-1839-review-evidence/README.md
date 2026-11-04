# Prior-art decision review controls

The original PR candidate awarded full reuse credit to eight rejected or quoted decisions. `red.log` records the test-first failures. A second review found two more cases involving contracted negation and a source line containing a reuse example; `review-red.log` records those failures before the follow-up fix.

`focused.log` records 72 passing tests across the scorer, plan contract, prompt propagation and chief settings. The scorer retains its original 0 / 0.5 / 1 score scale. The contract and scorer share prior-art section extraction.

`prepush.log` records all 25 checks passing, including 23 affected browser tests. The existing `scripts/prepush-known-red.json` allowance recognizes one macOS credential-argv environment failure in `apps/daemon/test/local-executor.test.ts`; this change does not modify that allowance. The broader selected suite records 4587 passing tests, one environment failure and one skipped test. Linux CI remains required.

The new `plan-prior-art` flow is registered in `scripts/eval-capabilities.json`. Its case grading is tested locally; no new real-model effectiveness score is claimed. Home-directory prefixes in archived logs are normalized to `<home>`; test outcomes and counts are unchanged.

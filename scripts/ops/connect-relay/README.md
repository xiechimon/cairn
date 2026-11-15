# Personal relay offline components

This is not an installable connector. The first component is the SQLite allowance ledger from the reviewed [relay protocol](../../../docs/design/connect-device-protocol.md), with [primary-source research](../../../docs/research/connect-do-enrollment-2026-11-15.md). It has no deployable Worker, route, credentials or cloud configuration. The synthetic transport experiment remains separate.

Use Node 24.22 or later within Node 24. Install with scripts disabled, then run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

On the shared development host, run tests from the repository root with `node scripts/heavy-slots.mjs run -- npm --prefix scripts/ops/connect-relay test`. Tests are serial and use actual local workerd/SQLite, including handler eviction, persisted runtime restart and test-only fault injection. No cloud login or model execution occurs.

`RelayLedger.reserve(now, cost)` commits all supplied daily counters atomically before returning. Use actual serialized UTF-8 output bytes; no refunds exist. Empty database creation is distinct from incomplete initialized storage, which fails closed. UTC rollover retains at most the current and previous calendar day; backwards time, identity mismatch, corrupt counters and SQL errors do not reset allowance. A failed reservation records the latest valid clock, but changes no usage counters. Deleting the entire database is an operator reset outside the guarantee.

The future transport still owns calling reservations on every required path, per-socket lifetime/rate limits, admission, correlation, authentication and closure after failure. This ledger does not meter provider ingress or guarantee Free account availability or a dollar ceiling. It is not wired to Cairn, deployment or the private service.

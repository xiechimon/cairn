# Personal relay offline components

This is not an installable connector. These are the SQLite allowance ledger, bounded digest registry and stateless HTTP ingress policy from the reviewed [relay protocol](../../../docs/design/connect-device-protocol.md), with [primary-source research](../../../docs/research/connect-do-enrollment-2026-11-15.md). There is no deployable Worker, route, credentials or cloud configuration. The synthetic transport experiment remains separate.

Use Node 24.22 or later within Node 24. First install the repository workspace with `pnpm install --frozen-lockfile --ignore-scripts`; shared schemas and the existing web Vite bundler are used by the ingress tests. In this directory, install with scripts disabled, then run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

On the shared development host, run tests from the repository root with `node scripts/heavy-slots.mjs run -- npm --prefix scripts/ops/connect-relay test`. Tests are serial and use actual local workerd/SQLite, including handler eviction, persisted runtime restart and test-only fault injection. No cloud login or model execution occurs.

`RelayLedger.reserve(now, cost)` commits all supplied daily counters atomically before returning. Use actual serialized UTF-8 output bytes; no refunds exist. Empty database creation is distinct from incomplete initialized storage, which fails closed. UTC rollover retains at most the current and previous calendar day; backwards time, identity mismatch, corrupt counters and SQL errors do not reset allowance. A failed reservation records the latest valid clock, but changes no usage counters. Deleting the entire database is an operator reset outside the guarantee.

The ledger initializes all four tables atomically on empty storage; existing ledger-only offline test databases are deliberately refused without migration or budget reset. `RelayRegistry` validates that ledger before each operation, then validates all bounded metadata before sweeping expiry or changing it. Registry rollback never refunds a previously committed budget reservation. It stores at most 20 grant digests bound to a host epoch, and 50 session digests with device IDs, fixed expiries and durable FIFO order. Grant consumption is atomic and never refunded on subsequent send failure. Retiring an epoch only removes its grants. Identical session reentry and reads do not change insertion order; conflicting device/expiry for a cached digest rejects without replacing it.

`findSession` returns metadata or a genuine cache miss, never authenticated authority. SQL failures and corruption throw rather than return a miss. Only call `rememberSession` after correlated host authorization: both cache hits and misses still need the full host validation/commit exchange. FIFO eviction and `forgetSession` do not revoke a host session or close an already authenticated socket. No raw code, bearer, cookie or message is accepted by these storage APIs.

`readRelayIngress` returns distinct descriptor, host-transport, presented-client-token and parsed-pairing decisions, or a bounded failure. It enforces canonical HTTPS configuration, exact origin/routes/methods, role-separated headers, browser Origin/Fetch Metadata, duplicate-cookie rejection and the actual 1KiB streamed UTF-8 JSON limit. Host transport uses constant-time capability comparison. Client success is only syntax validation, not authentication; the host must still validate the real scoped session through the complete admission/commit exchange. Pairing cookies never replace grant redemption. Returned tokens/codes are transient and must not enter diagnostics, attachments or SQL. The function creates no Response, socket, cookie, counter or dispatch. Tests bundle the actual shared schemas with the workspace's existing Vite and run the policy on native local workerd Request/Headers/streams/crypto, using only a generated inspection wrapper.

Pairing accepts only `application/json`, optionally followed by one UTF-8 charset parameter (case-insensitive, optionally quoted). Combined media types, other parameters and other charsets reject; the entire header is validated rather than ignoring the suffix after a semicolon.

The future transport still owns calling reservations on every required path, per-socket lifetime/rate limits, admission, correlation, authentication and closure after failure. This ledger does not meter provider ingress or guarantee Free account availability or a dollar ceiling. It is not wired to Cairn, deployment or the private service.

The future routed layer must repeat ingress checks at the Worker and DO boundaries, bound slow-body/admission time, reserve dynamic/pair/upgrade/output costs, and issue no-store/no-referrer/no-CORS responses. This parser does not supply those guarantees or complete the connector's offline pairing-to-result acceptance.

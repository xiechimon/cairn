# Personal secret gateway offline prototype

This is a disposable Node HTTP/TLS experiment, not an installed gateway or a replacement for the production egress relay. Its contract comes from [the design](../../../../docs/design/secret-gateway.md) and [prior-art research](../../../../docs/research/1775-gateway-prior-art.md). The installed `@peculiar/x509` 1.14.3 README and type declarations were checked for certificate generation; Node owns HTTP and TLS parsing. No TLS, HTTP or ASN.1 parser is implemented here.

## Run without external services

Install the standalone dependencies once, without lifecycle scripts:

```sh
npm ci --ignore-scripts --prefix scripts/ops/orb/secret-gateway-prototype
```

Choose an already installed Orb image with Node and set `PROTOTYPE_IMAGE` to its immutable image ID. The runner uses `--pull=never`; it never downloads an image. From the repository root, with an existing evidence directory:

```sh
ulimit -c 0
PROTOTYPE_IMAGE=<local-image-id> \
PROTOTYPE_EVIDENCE=<absolute-path-to-result.json> \
node scripts/owned-process.mjs -- node scripts/ops/orb/secret-gateway-prototype/run.mjs
```

The host runs the trusted fixture upstreams, registration client and gateway in one process. A random synthetic value and signing keys exist only in that process's memory. The only guest bind is its dedicated read-only directory containing a public CA certificate and a listener socket. Guests run with no network, a read-only root, no capabilities, no privilege escalation and core dumps disabled. Requests reach the host through the Unix socket. Gateway-to-upstream TLS uses a separate fixture trust store and verifies `allowed.test`; loopback dialing is fixture-only, not a change to production address policy. There are no real credentials, model calls, host trust-store edits, daemon configuration changes or firewall changes.

## What the assertions establish

Eighteen fresh guest processes exercise success, wrong host/port, Host/SNI mismatch, missing SNI, wrong placeholder location, duplicate headers, TRACE, absolute-form targets, redirects, cross-guest attempts, missing CA, invalid upstream identity, success after refusals, and admin-disconnect revocation. Each guest checks its network interfaces, mounted files, read-only listener directory and absent administrative/sibling paths. SNI-negative probes still verify the expected interception certificate identity, so a client-side hostname failure cannot hide missing gateway SNI checks.

The upstream checks the exact synthetic value in memory and records booleans, never raw authentication. The evidence contains simulated tool results, guest request/response bytes, stdout/stderr and value-free gateway audit events. The runner scans those artifacts for the synthetic value before writing evidence; it aborts rather than persisting a matching artifact. This is not a secure-erasure claim. Containers and temporary listener/certificate directories are removed on normal completion and handled failure.

## Limits

This experiment supports one fixed origin, header, template and active registration per guest. Other destinations are refused rather than passed through. It does not extend or install `egress-relay.mjs`, implement production admin authentication/reconciliation, or establish DNS/address admission, restart recovery, in-flight revocation, arbitrary body handling or general proxy compatibility. Fixture responses deliberately never echo the credential; the design's upstream-reflection limitation still applies.

Envoy was not available locally and was not compared; no production data plane is selected. The curl/git/Python/claude trust matrix, nspawn and actual SDK session/transcript scans have not run. Normal daemon-step E2E remains blocked by #4543; this independent podman experiment neither disables bubblewrap nor proves that gate works.

Repeated attempts hit the 15-second container deadline without guest output, including post-commit runs at the revoked and authorized probes. Podman events for the revoked container recorded create but no init or start before cleanup; the authorized container reached start but produced no guest output before cleanup. Host load was high, but the underlying stall remains unexplained. Earlier complete runs passed with the same executable source hashes; the runner reports the failing case and checks outputs before emitting diagnostics. The deadline remains a hard failure, not a retry or a host-shell fallback. Passing evidence does not establish reliable container execution under contention.

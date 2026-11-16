# Personal DO relay experiment

Local-only synthetic transport, not a Cairn connector or an installable phone/web feature. The host and clients are simulated Node endpoints. Nothing connects to the Cairn server, model APIs or a Cloudflare account. Existing Tailscale access and Tunnel work are unchanged.

## Run locally

Use Node 24.x, version 24.22 or later within that release line. Node 26 removed the TypeScript transform API used by this harness and is unsupported. Install the Cairn workspace first with lifecycle scripts disabled. The SQLite compatibility test uses its actual server schema, native in-memory database bootstrap, Drizzle and web Vite installation; it cannot run from a detached copy of this package. Then install this experiment's dependencies:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run smoke
```

Inside the Cairn repository on a shared host, run tests through its shared admission wrapper from the repository root:

```sh
node scripts/heavy-slots.mjs run -- npm --prefix scripts/ops/connect-do-prototype test
```

Tests are serial, start workerd on an ephemeral loopback port and dispose it afterward. Each runtime creates independent experiment-only role capabilities in memory. No account login, model key, `.dev.vars`, CLI credential argument or credentials printed to the terminal is needed. Miniflare uses disposable local storage; disposing the runtime discards its capabilities and SQL budget. Hibernation is tested by actual handler eviction with sockets retained, not by disconnect/reconnect.

The smoke output should report two isolated synthetic clients and identity retained after eviction. Clock changes, simulated send failure and delayed-close callbacks exist only in a test-generated wrapper; `worker.ts` contains none of those test routes.

## Cloud control-plane storage compatibility

The separate `sqlite-compat.worker.ts` fixture tests the first gate of the [multi-runner design](../../../docs/design/user-owned-cloud-control-plane.md), not the single-host relay. It is bundled only into local Miniflare tests and is not referenced by the deployment manifest. Its unauthenticated inspection endpoints must never be deployed.

The test derives current empty-schema DDL from the real native `openMemoryDb()` bootstrap, loads it into an isolated DO, and uses the real shared Drizzle schema/DO driver. It checks JSON/boolean/null/default mappings, two competing conditional updates with one returning-row winner, zero-row and held-step boundaries, rollback (including caught nested failures), restart persistence and actual `.run()` metadata. Native bootstrap is used only to obtain empty-schema statements; no user database is opened or uploaded. This is not proof that historical migrations run inside DO, that the current native `Db` type is interchangeable, or that machine routing/authentication/runner execution works in cloud mode. Claims here are SQL query shapes, not the production claim service.

The lease test also invokes the real production `acquireLease` through its shared synchronous database contract: acquisition, same-owner renewal, heartbeat, strict expiry, stale-owner fencing, release and restart persistence. Prototype typechecking compiles this DO caller without a cast; server typechecking covers native callers. This lease-only contract does not make other native database consumers portable. Acquisition returns at most one key from one VALUES tuple; heartbeat uses primary-key equality. The fixture's native-derived DDL preserves the non-null store primary key required by those bounds.

The SQLite fixture persists across its deliberate runtime restart, then deletes its own temporary directory. The original relay tests and smoke remain synthetic transport tests. To run only the original standalone experiment without workspace dependencies, use `node --test --test-concurrency=1 relay.test.mjs` and `node smoke.mjs`.

## Deliberate limitations

- One host and up to 16 clients. Exact [protocol and security design](../../../docs/design/connect-do-prototype.md).
- Header bearer auth excludes ordinary browser WebSocket clients; there is no pairing or first-owner UI.
- No owner/device/machine/model credentials, command execution, HTTP proxying or task retry.
- Fixed one-hour sessions. No individual revocation or credential rotation.
- Plaintext is visible to the relay. No E2EE or cloud trust clearance for private content.
- Cumulative output caps: 1MiB/socket, 8MiB/DO. Reconnect/hibernation never refunds them. This finite experiment stops, rather than being an always-on transport. Only a full local-runtime reset restores the DO budget.
- Free-tier availability, account-wide abuse/billing controls, real phones and Cairn first-result onboarding are unverified.

`wrangler.jsonc` is a future deployment manifest, not a running deployment. Do not run `npm run deploy`, create cloud resources or configure cloud secrets without the owner's explicit approval. A public cloud trial needs a separate account-wide usage budget and enrollment/trust design first.

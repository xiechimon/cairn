# Personal DO relay experiment

Local-only synthetic transport, not a Cairn connector or an installable phone/web feature. The host and clients are simulated Node endpoints. Nothing connects to the Cairn server, model APIs or a Cloudflare account. Existing Tailscale access and Tunnel work are unchanged.

## Run locally

Use Node 24.x, version 24.22 or later within that release line. Node 26 removed the TypeScript transform API used by this harness and is unsupported. This package is independently installable, without the Cairn workspace:

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

## Deliberate limitations

- One host and up to 16 clients. Exact [protocol and security design](../../../docs/design/connect-do-prototype.md).
- Header bearer auth excludes ordinary browser WebSocket clients; there is no pairing or first-owner UI.
- No owner/device/machine/model credentials, command execution, HTTP proxying or task retry.
- Fixed one-hour sessions. No individual revocation or credential rotation.
- Plaintext is visible to the relay. No E2EE or cloud trust clearance for private content.
- Cumulative output caps: 1MiB/socket, 8MiB/DO. Reconnect/hibernation never refunds them. This finite experiment stops, rather than being an always-on transport. Only a full local-runtime reset restores the DO budget.
- Free-tier availability, account-wide abuse/billing controls, real phones and Cairn first-result onboarding are unverified.

`wrangler.jsonc` is a future deployment manifest, not a running deployment. Do not run `npm run deploy`, create cloud resources or configure cloud secrets without the owner's explicit approval. A public cloud trial needs a separate account-wide usage budget and enrollment/trust design first.

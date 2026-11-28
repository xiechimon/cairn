# Remote access as an in-app switch

**Newcomer.** Someone who installed Cairn today opens Settings → Remote access to
reach this Cairn from a phone. The page used to tell them to set `CAIRN_TSNET=1`
and restart — a path no Mac app user can take. Now the page leads with one
switch, `远程访问`. Turning it on starts the embedded Tailscale (tsnet) node in
place. On first start the node asks for a Tailscale login: the page shows the
login link the node prints and a QR code of it. After login it shows the
node's tailnet address and the pairing section works as before. Turning it off
stops the node. The choice is remembered across restarts. The only accounts
involved are the owner's own Tailscale account and the pairing codes the page
already issued; no Cairn account, payment or key is asked.

## State

One record: `<dataDir>/tsnet-remote.json` (`{"enabled": boolean}`, mode 0600,
same directory as `tailscale-serve.json`). It holds the user's intent, not the
runtime state.

Runtime state lives in a `TailnetRemote` controller
(`apps/server/src/services/tsnet-remote.ts`) that wraps today's
`startTsnetRemote`/`superviseSidecar`. It projects `{enabled, state, dnsName,
ips, authUrl, error}` where `error` is a coarse kind —
`missing-binary | auth-off | unavailable | crashed | null` — never raw text
(the routes response must not leak local paths; remote-access.test.ts pins
that).

Readers and writers of the persisted flag:

| Path | Read | Write |
|---|---|---|
| boot (`createTsnetRemote`) | record + env | — |
| `POST /api/remote/tailnet {enabled}` (owner only) | — | record, then start/stop |
| `GET /api/remote/routes` | live status | — |

`CAIRN_TSNET` keeps a role as a **boot override for tests and packaged
deployments**, never the user path: when it is set it decides the boot state
(`1|true|yes` embedded, anything else off), ignoring the record; when unset
the record decides. The switch still starts and
stops the node at runtime either way. `CAIRN_AUTH=off` refuses enabling: the
tailnet socket requires the access token (unchanged rule).

## Transitions

```
off ──enable──▶ starting ──▶ needs-login ──▶ ready
                   │              │             │
                   ▼              ▼             ▼
                 failed ◀── crash/backoff ── restarting ──▶ ready
any state ──disable──▶ off
enable while failed ──▶ fresh start (retry)
```

- `enable()` writes the record first, then starts the supervisor. A
  synchronous refusal (missing binary, auth off) becomes `failed` with its
  kind; the record stays `true` so a later install that gains the binary
  starts on its own.
- `disable()` writes the record, then stops the supervisor and closes the
  tailnet socket. When `enabled` is false the projected state is always `off`.
- Boot with the record `true` replays `starting` → `needs-login`|`ready`.
  tsnet state under `<home>/tsnet/state` already survives restarts, so a node
  that finished login comes back `ready` without asking again.
- `resume()`, `setEnabled` and `stop()` share one queue: every start/stop
  runs after the previous finishes, so a boot resume racing a runtime toggle
  cannot orphan a running sidecar.

## Failure behavior (one sentence each)

| Failure | Projected | Server behavior |
|---|---|---|
| `CAIRN_AUTH=off` | `failed/auth-off` | refused before spawn, nothing created |
| sidecar binary absent or not executable | `failed/missing-binary` | no spawn, no socket, no dirs |
| state dir not private / socket path too long / socket in use | `failed/unavailable` | no spawn |
| spawn error or sidecar exits | `restarting` with backoff, then `failed/crashed` after the supervisor gives up | supervisor backoff unchanged |
| node needs (re-)login | `needs-login` + `authUrl` | sidecar keeps polling; `ready` on login |
| server shutdown | `stopped` → `off` | graceful sidecar shutdown as today |

## API

- `GET /api/remote/routes` — `tailnet` gains `enabled: boolean` and
  `error: kind|null`; `state` keeps today's enum (`off`, `starting`,
  `needs-login`, `ready`, `restarting`, `failed`, `stopped`). `authUrl` is a
  one-shot tailnet-join credential, so it is returned to the owner only;
  paired-device readers get `null` while the rest of the status is unchanged.
- `POST /api/remote/tailnet` — body `{enabled: boolean}`, owner only (the
  token-auth middleware lists it in `isOwnerOnlyRoute`, and the handler keeps
  the same `requireOwner` as pairing). Returns the projected tailnet object.
  404 when no controller is wired; 409 when auth is off; controller failures
  surface as a logged 500, never raw error text.

Pairing rules are unchanged: pairing codes, per-device tokens and owner-only
management work exactly as commit `d5d29d9eb` made them; this change only
decides whether the tsnet node runs and shows it.

## Binary resolution

`CAIRN_TSNET_BINARY` still wins. Otherwise the first existing of
`<server>/../tsnet-sidecar-<goos>-<goarch>` then `<server>/../tsnet-sidecar`
(bundled in the Mac app at `Resources/server/`; a repo build at
`apps/server/`), then the documented `<home>/bin/tsnet-sidecar`. The Mac app
ships `tsnet-sidecar-darwin-arm64` and `tsnet-sidecar-darwin-amd64`, built by
the release workflow from `apps/tsnet-sidecar`. An `npx` install that finds no
binary shows `failed/missing-binary` — the npm-side packaging is a separate
step, out of scope here.

## Tests

One per path: record read/write, env override wins over record, enable →
spawn + 0700 dirs + socket, disable → stop + socket gone, enable-while-failed
retries, error kinds map, routes response carries `enabled`/`error`, POST is
owner-only and 404/409 in the unwired/auth-off cases. Existing
`tsnet-remote.test.ts` and `remote-access.test.ts` keep their security
assertions (no leaked paths, tailnet identity never authenticates).

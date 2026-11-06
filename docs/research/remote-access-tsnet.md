# Embedded tsnet remote access (D103)

> **Question.** How does cairn embed Tailscale `tsnet`, keep a client route list (LAN, tailnet, Funnel), and open Funnel safely?
>
> **Fixed by D103 (2026-11-06), not revisited here.** The user's own Tailscale account through one-click login; no cairn-run server and no headscale; the phone uses the Tailscale app or an opt-in Funnel URL; first-answering route wins; VNC frames never use a public route. The model is t3code `docs/user/remote-access.md` and `docs/internals/remote.md` (commit `c55db3e9c`).
>
> **Marks.** **M** = measured this session (file read or command output, source named). **I** = inferred from M.

## 1. Current state

| Area | Today | Source |
|---|---|---|
| Serving | One Hono app via `@hono/node-server` `serve()`. The server binds `HOST` when set and every interface when not, on `PORT` (default 8787). It also serves the SPA from `webDir`. | M: `apps/server/src/index.ts:184-189`, `apps/server/src/config.ts:142,165` |
| Auth | One owner token (`CAIRN_TOKEN` or `~/.cairn/token`). It is sent as a Bearer header, or as `?token=` on SSE streams only. A `null` token installs no guard. | M: `apps/server/src/lib/token-auth.ts:54-78` |
| Token-exempt paths | Everything outside `/api/`, plus `/api/machine*` (machine token), `/api/mcp` and `/api/oauth/callback`. `/git/*` uses its own Basic auth. | M: `token-auth.ts:13-20`, `routes-git-hosting.ts:35-40` |
| Tailscale today | Manual `tailscale serve` to `127.0.0.1`. `Tailscale-User-Login` is trusted only when it is on the allowlist and the TCP peer is loopback. The docs forbid Funnel. | M: `docs/deploy/tailscale-mobile.md`, `token-auth.ts:44-52`, `config.ts:199-203` |
| Web credential | The token is stored per origin in `localStorage['cairn.token']`. The login link carries it in `#token=`. | M: `apps/web/src/api/auth.ts:3,100` |
| Machine enrollment (#3020, #3032) | The daemon calls `enroll/start` with no auth. The owner approves at `/app/machines/authorize?enroll=…`, and `confirm` requires owner Bearer or allowlisted identity. The approval URL origin comes from `forwardedOrigin`, which trusts `x-forwarded-*` from loopback peers. | M: `routes-machine.ts:158-175,260-305`, `apps/daemon/src/machine-enroll.ts` |
| Screen (noVNC) | A WebSocket upgrade on `/api/computer-screen/<64hex>` with a one-shot channel. It checks for a same-origin request and a capability subprotocol. | M: `apps/server/src/services/computer-screen.ts:243-280,366` |
| Desktop app | It does not exist yet. Specs keep an Electron/Tauri-class shell wrapping the same SPA as a premise. | M: `docs/spec/02-architecture-parity.md:42`; grep finds no electron/tauri package |
| Bind safety | Issue #2057 (open): an unset `HOST` with a null token leaves the API open on every interface. | M: `gh issue view 2057` |

## 2. tsnet integration shape

Upstream facts:

- Pinned upstream: `tailscale/tailscale` v1.104.5 (2026-11-03), `go 1.27.3` (M: GitHub release API, `go.mod`).
- Auth order: auth key, then OAuth client secret or workload identity, then an interactive login URL printed through `UserLogf`. Stored state wins on the next start (M: `tsnet/tsnet.go:70-76,279`). The sidecar can poll the login URL from `StatusWithoutPeers().AuthURL` (M: `tsnet.go:1205-1208`).
- State: `Dir` defaults under `os.UserConfigDir`, and `Store` defaults to `Dir/tailscaled.state` (M: `tsnet.go:234-254`).
- Identity: `LocalClient().WhoIs(remoteAddr)` (M: `tsnet.go:79-90`).
- Funnel: `ListenFunnel("tcp", ":443"|":8443"|":10000", FunnelOnly())` returns a TLS listener. It fails without HTTPS certs or the `funnel` node attribute (M: `tsnet.go:1538-1680`; https://tailscale.com/kb/1223/funnel).

| | (a) Go sidecar on tsnet | (b) libtailscale C ABI | (c) bundled `tailscaled --tun=userspace-networking` |
|---|---|---|---|
| Node binding | None needed: a child process that speaks JSON lines on stdio. | None upstream: the repo ships `python/`, `ruby/`, `swift/` only (M). We would write and maintain a N-API addon. | None: drive the `tailscale` CLI. |
| API surface | Full tsnet: `Listen`, `ListenTLS`, `ListenFunnel(FunnelOnly)`, `WhoIs`, `AuthURL`. | Narrow: `tailscale_listen`, `tailscale_enable_funnel_to_localhost_plaintext_http1`, `status_json`. The header has no WhoIs (M: `tailscale.h`). | Full, via `tailscale serve/funnel` and the identity header. |
| Build | `CGO_ENABLED=0 GOOS/GOARCH` cross-compiles from one runner to darwin/arm64, darwin/amd64, linux/amd64, linux/arm64 and windows/amd64 (I: tsnet.go has no build tags, M). | `-buildmode=c-archive` needs cgo and a C toolchain per target, plus prebuilt addons per Node ABI (I). | Two binaries per target, plus socket and state paths. It can collide with a user's existing `tailscaled` (I). |
| Size | About 25-35 MB per target (I: the `tailscaled` 1.104.2 binary on omarchy is 30,028,792 B, M). | Similar, and loaded into the Node process (I). | About 30 MB plus the CLI (M/I). |
| Failure isolation | A crash restarts a child, and the server stays up. | The Go runtime runs inside Node: signals and threads are shared, and a crash kills the server (I). | Child process (good), but the most moving parts. |

**Recommendation: (a) a Go sidecar** (`apps/tsnet-sidecar/`, its own Go module), supervised by the server. Reasons:

- It is the only option with WhoIs and FunnelOnly listeners without writing C.
- Pure-Go cross-compile works on one CI runner.
- Process isolation keeps a Tailscale fault from killing the server.

When the desktop shell exists, it ships the same binary. The sidecar opens separate listeners per route class:

- tailnet: `ListenTLS(":443")`;
- Funnel, only when enabled: `ListenFunnel(":8443", FunnelOnly())`.

Each listener proxies to its own server listener (a Unix socket, or a named-pipe or loopback port on Windows). The server then learns the route from the socket that accepted the connection, never from a header (I).

**Toolchain impact.**

- CI needs `actions/setup-go` and a matrix `go build` / `go test`. This touches `.github/**`, which is protected.
- Binaries ship like esbuild: per-platform optional npm packages. That changes `package.json` and `pnpm-lock.yaml`, and the lockfile change needs ian's confirmation and `CAIRN_ALLOW_LOCKFILE_CHANGE=1`.
- biome.json: no change. The locked-import rules (`@earendil-works/*`, MCP sdk, claude-agent-sdk, ACP, OTel) cover TS imports, and the sidecar is spawned, not imported. Keep the spawner one thin module, `apps/server/src/lib/tsnet-sidecar.ts`, in the same spirit (M: biome.json lines 68-108).
- `apps/daemon/src/backend/` is unaffected: tsnet is not GitOps, MCP or an LLM provider (I).

## 3. Route list and auto-selection

**Data model (client-side, per t3code).** The client saves `Environment { environmentId, routes: Route[] }`, where `Route = { url, kind: 'lan'|'tailnet'|'funnel'|'user', origin: 'saved'|'learned', learnedVia?, pairedOverHttps, lastOkAt, cooldownUntil }`. The server owns only identity and hints:

- `GET /api/remote/descriptor`, unauthenticated: `environmentId` and version, nothing else.
- `GET /api/remote/routes`, authenticated: current LAN IPv4 addresses and the tsnet name and IPs. It includes the Funnel URL only when Funnel is on.

`environmentId` is persisted once, atomically, in `dataDir`.

**How addresses are learned.**

- Pairing scans a QR code or link. The fragment carries a one-time code, which keeps it off the request, as t3code does for hosted pairing.
- While connected, the client refreshes `/api/remote/routes`, adds learned routes and drops learned routes that are no longer reported.
- Saved routes are never touched.

**Credential across routes.**

- The single owner token is the wrong unit, because it cannot be revoked per device.
- Pairing exchanges the code for a per-device token. The token is not origin-bound, so it is reused on every route of that environment.
- The token is sent only after the route's descriptor reports the same `environmentId`.
- A token paired over HTTPS never travels to a plain-HTTP route (t3code `remote.md`, "Identity is independent of the route").

**Browser constraint (I).** A PWA served over `https://<node>.ts.net` cannot call `http://192.168.x.y` (mixed content), and its `localStorage` is per origin. So:

- on the phone, the useful list is tailnet HTTPS, then Funnel HTTPS, using cross-origin calls that need an explicit CORS allowlist of the environment's own route origins;
- LAN routes pay off in the desktop shell, or when the page itself was loaded over LAN.

**Failure modes (tests first).**

| # | Failure | Required behavior | Test |
|---|---|---|---|
| F1 | A saved LAN IP now belongs to another machine | Descriptor mismatch, so no token is sent. | Unit test on the driver with a fake descriptor |
| F2 | Every route is silent | Try each route anyway, then surface "unreachable". | Unit |
| F3 | An HTTPS-paired token meets a learned `http:` route | Route refused. | Unit |
| F4 | The server stops reporting an address | The learned route is dropped and saved routes stay. | Unit |
| F5 | A flaky earlier route | Preflight includes auth, and a failure gets a cooldown. | Unit with fake timers |
| F6 | A route answers 401 | Skip it without dropping the live session. | Unit |
| F7 | An HTTPS page offers an `http:` route | Filtered out in a browser context. | Unit |
| F8 | Screen upgrade over Funnel | Refused by the server listener class, and the client never offers it. | Server integration |
| F9 | tsnet needs login or the node key expired | AuthURL is surfaced in the UI and state persists. | Sidecar Go test against `tstest` control |
| F10 | The sidecar crashes | Restart with backoff, and remove tailnet and Funnel routes from `/routes`. | Server test with a fake sidecar |
| F11 | Funnel is not permitted (no node attribute or HTTPS) | The `ListenFunnel` error is shown and Funnel stays off. | Sidecar unit |
| F12 | Forged `Tailscale-User-*` or `X-Forwarded-*` | The sidecar strips them. Identity comes from WhoIs on the tailnet only. | Server and sidecar integration |

## 4. Security of Funnel

Funnel makes every exempt path public: the SPA, `enroll/start`, `/api/mcp`, `/api/oauth/callback` and `/git/*` (M, §1). These must hold before the Funnel toggle can turn on:

1. **A token is mandatory.** Enabling refuses while `authToken === null`, which is the #2057 condition. #2057's loopback default bind must land first, so the sidecar remains the only off-host path (I).
2. **Listener-class trust.** Funnel connections reach a dedicated server socket. On that socket:
   - the `Tailscale-User-Login` trust and `forwardedOrigin` header trust are off;
   - `enroll/start` is rejected;
   - screen upgrades are refused, which enforces the VNC rule;
   - 401 responses are rate-limited.

   This touches `apps/server/src/lib/token-auth.ts` and `routes-machine.ts` (both protected).
3. **Per-device tokens** (§3), so a token leaked over the public route can be revoked alone.
4. **Off by default.** It is a persisted setting, with no environment-variable default and no `flag()` gating. Enabling shows an explicit warning naming the public URL and the bandwidth cap, and it requires confirmation. A test proves that a fresh home serves no Funnel listener.
5. The Funnel facts the UI must state come from https://tailscale.com/kb/1223/funnel (M):
   - all plans;
   - beta;
   - ports 443/8443/10000 only;
   - TLS only;
   - bandwidth limits that cannot be configured.

## 5. Segments

| # | PR | Acceptance check | Protected paths touched |
|---|---|---|---|
| S1 | `apps/tsnet-sidecar` Go module pinned to tsnet v1.104.5. It speaks JSON-line control on stdio (`authUrl`, `ready{ips,dnsName}`, `funnel{url\|error}`) and proxies to Unix sockets with header stripping. A CI matrix builds 5 targets. | `go test` covers F9, F11 and F12 strip. The CI artifact is ≤40 MB per target. A local run prints `authUrl`. | `.github/**`, `**/scripts/**` if build scripts, `**/package.json` |
| S2 | Server spawner (`lib/tsnet-sidecar.ts`) and per-class listeners. It derives identity from the sidecar's WhoIs instead of the header-on-loopback check. It persists `environmentId`. | A fake-sidecar test covers F10 and F12. A default-off test: no setting, no spawn, no socket. | `apps/server/src/lib/token-auth.ts` (credentials) |
| S3 | Descriptor and routes endpoints, pairing code to per-device tokens, QR pairing UI, revoke. Blocked on the #2057 decision. | Pair, revoke, then 401. The descriptor leaks no data. F1 server side. | `token-auth.ts`, likely `services/api-keys.ts`, `drizzle/**` |
| S4 | Web route store, driver and supervisor (first-answer, preflight, cooldown, CORS allowlist). | Unit tests for F1-F7. `e2e:affected` runs with two local ports, one killed mid-session. | None (`apps/*/src/**` is in autoMerge) |
| S5 | Funnel opt-in: setting, warning dialog, refusal on a null token, Funnel listener class policy (enroll, screen, 401 rate limit). | F8 and the refusal tests. A live smoke on omarchy: Funnel URL from the phone network, then the screen upgrade is refused. | `token-auth.ts`, `routes-machine.ts` |
| S6 | Packaging: per-platform optional npm packages, and the README and `docs/deploy/tailscale-mobile.md` rewrite. | `npx @xiechimon/cairn` on macOS arm64 and Linux finds the binary. | `**/package.json`, `pnpm-lock.yaml` (ian confirms) |

Order: S1 → S2 → (S3 ∥ S4) → S5 → S6. S2, S3 and S5 touch canonical security surfaces (`credentials`, `machineAndCommandBoundary` in `packages/shared/merge-gate-paths.json`), so they need zero unresolved security findings.

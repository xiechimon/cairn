# Seamless browser auth from the owner's own tailnet devices (2026-11-08)

> **Question.** The owner opens cairn at `https://<node>.<tailnet>.ts.net` (system `tailscale serve` to `127.0.0.1:8787`) from another of his own devices on the same tailnet and gets the "Access token required" dialog. How do comparable self-hosted tools authenticate a browser on the user's other devices, what does each trust, and what should cairn do so the owner's browser works without pasting a token, while non-tailnet deployments keep a safe fallback?
>
> **Marks.** **Observed**: read first-hand (source file at a pinned ref, official doc page, or command output in the research session). **Inferred**: derived from observed evidence and checkable. **Speculative**: everything else.
>
> **Refs.** cairn code is cited at `origin/main` `a2e2ebb51`. Tailscale source is cited at tag `v1.104.2` (the version installed on the server host). t3code at `main` `8e6a73230` (2026-11-08).
>
> **Builds on.** [`remote-access-tsnet.md`](remote-access-tsnet.md) (D103, issue #3070) and #2057 / PR #3073. This note does not reopen D103. It answers the one piece D103 left as "S2: identity from the sidecar's WhoIs", which has not been wired into auth yet.

## 1. Why the dialog appears today

| Fact | Mark | Source |
|---|---|---|
| The running service sets `HOST=127.0.0.1` and still sets `CAIRN_TAILSCALE_USERS=<owner login>`. | Observed | `/proc/<server pid>/environ`, names and allowlist value only |
| PR #3073 (#2057) made the `Tailscale-User-Login` header stop granting access. Startup now logs `CAIRN_TAILSCALE_USERS is ignored — the Tailscale-User-Login header no longer grants access`. The current journal has 93 such lines. | Observed | [#3073](https://github.com/xiechimon/cairn/pull/3073); `apps/server/src/config.ts:243-245`; `journalctl --user -u cairn-server` |
| Reason for retiring it: header trust checked only "TCP peer is loopback". Any local process (another Unix user, a lane, a batch runner) could forge the header and get the full owner API. The host now has a second local account (the #2189 runner user). | Observed | [#2057 comment](https://github.com/xiechimon/cairn/issues/2057); `getent passwd` |
| From the owner's Mac (untagged node, same Tailscale user as the server node), `GET /api/teams` through serve returns **401** and `/` returns 200. So the SPA loads, the first API call fails, and the gate opens. | Observed | `curl` over ssh from the Mac; `tailscale status --json` (all 5 nodes untagged, all owned by one user) |
| Once pasted, the token is kept per origin in `localStorage['cairn.token']`. The paste costs once per browser profile, then again after every `cairn token --rotate`. | Observed | `apps/web/src/api/auth.ts:3,31` |
| On main, the tsnet listener already parses `Tailscale-User-Login` from its 0600 Unix socket (`tailnetIdentityOf`), but no auth path calls it. Only `tailnetOriginOf` is used. | Observed | `apps/server/src/lib/tailnet-listener.ts:60-64`; `git grep tailnetIdentityOf` |

**Conclusion (inferred).** This is not a bug in serve or in the Mac. The product deliberately removed the only seamless path (#3073), and D103 S2's replacement, identity on a listener that only trusted proxies can reach, is half built: the socket and parser exist, the admit rule does not.

## 2. Tailscale facts that decide the design

| Fact | Mark | Source |
|---|---|---|
| Serve deletes any client-sent `Tailscale-User-Login/-Name/-Profile-Pic`, `Tailscale-Funnel-Request` and `Tailscale-Headers-Info`, then sets them from `WhoIs(SrcAddr)`. | Observed | [`ipn/ipnlocal/serve.go:1098-1127`](https://github.com/tailscale/tailscale/blob/v1.104.2/ipn/ipnlocal/serve.go#L1098-L1127) |
| No identity headers for Funnel traffic (it sets `Tailscale-Funnel-Request: ?1` instead), for **tagged** source nodes, or for traffic from the local machine (WhoIs miss). | Observed | same lines; [KB 1312 serve](https://tailscale.com/kb/1312/serve) "not populated for traffic originating from tagged devices" |
| A self-request through serve on the server host also returns 401 even with header trust, because local-machine traffic gets no headers. | Observed | `curl --noproxy '*' https://<node>/api/teams` on the host returned 401; source comment `// traffic from outside of Tailnet (funneled or local machine)` |
| **Shared-in users get identity headers too**: "this includes traffic from external users who have accepted a share of your device". | Observed | [KB 1312](https://tailscale.com/kb/1312/serve) |
| Tailscale's own guidance: the backend should listen only on localhost, which "limits tampering to only other services running on the Serve device". | Observed | [KB 1312](https://tailscale.com/kb/1312/serve) |
| Serve can proxy HTTP to a Unix socket (`tailscale serve unix:/path`, Linux/macOS/BSD), and identity headers are added on that path too. Serving a Unix socket needs root (or the operator). | Observed | [`cmd/tailscale/cli/serve_v2.go:143-156`](https://github.com/tailscale/tailscale/blob/v1.104.2/cmd/tailscale/cli/serve_v2.go#L143-L156); `serve.go:695-697,888-902,998`; KB 1312 limitations |
| The default policy file allows all devices to talk to each other. | Observed | [KB 1018 ACLs](https://tailscale.com/kb/1018/acls) |
| `tailscaled.sock` on the host is `srw-rw-rw- root`. Any local user can call LocalAPI read calls such as WhoIs. | Observed | `ls -l /var/run/tailscale/tailscaled.sock` |
| tsnet exposes `LocalClient().WhoIs(ctx, r.RemoteAddr)` for an in-process listener. | Observed | [`tsnet/tsnet.go:79-90,440`](https://github.com/tailscale/tailscale/blob/v1.104.2/tsnet/tsnet.go#L79-L90) |
| cairn's sidecar strips every `Tailscale-*` and `X-Forwarded-*` header, then sets `Tailscale-User-Login/-Name` from WhoIs and skips tagged nodes. It does **not** reject sharee nodes and does not report its own owner login. | Observed | `apps/tsnet-sidecar/internal/sidecar/proxy.go:55-95`, `node.go:71-86`, `protocol.go:22-32` |

## 3. Comparison

| Source | How a browser on another device gets in | Trade-offs | Link |
|---|---|---|---|
| **Tailscale web client** (`tailscale web`, port 5252) | `WhoIs(RemoteAddr)` on every request. It refuses tagged sources, and on an untagged server it refuses any user other than the server node's own user (`errNotOwner`). The owner then gets a `TS-Web-Session` cookie bound to (source node ID, user ID) for 30 days. On tailscale.com control it first runs a "check mode" re-auth URL. CSRF: requires `Sec-Fetch-Site: same-origin` on non-GET requests, else Origin must equal Host. Observed | Zero config for the owner. Sharees and tagged nodes are out by construction. The cookie is ambient, so CSRF checks are mandatory. Check mode depends on Tailscale's control plane. | [`client/web/auth.go:24-185,317-352`](https://github.com/tailscale/tailscale/blob/v1.104.2/client/web/auth.go#L110-L127), [`client/web/web.go:241-295`](https://github.com/tailscale/tailscale/blob/v1.104.2/client/web/web.go#L241-L295) |
| **Tailscale `nginx-auth`** | An auth-request helper on a Unix socket. It calls WhoIs on the proxied `Remote-Addr`/`Remote-Port`, returns 403 for tagged nodes, can require `Expected-Tailnet`, and returns the login to nginx. Observed | Identity per request, no session. Trust depends on nginx passing the real peer address, and sharees show an empty tailnet. | [`cmd/nginx-auth/nginx-auth.go:40-92`](https://github.com/tailscale/tailscale/blob/v1.104.2/cmd/nginx-auth/nginx-auth.go#L40-L92) |
| **Tailscale Serve identity headers** | Serve rewrites the three identity headers on every tailnet request. Observed | Free if the backend is reachable only through serve. Absent for tagged sources and Funnel. Includes sharees. Forgeable by anything that can reach the backend port directly. | [KB 1312](https://tailscale.com/kb/1312/serve), `serve.go:1098-1127` |
| **Open WebUI trusted header** | `WEBUI_AUTH_TRUSTED_EMAIL_HEADER=Tailscale-User-Login` auto-registers and signs in whatever login the header names. The official Tailscale tutorial runs a serve sidecar container. Observed | Seamless. Its docs warn that misconfiguration lets anyone "authenticate as any user", and tell you to bind `127.0.0.1` or block direct access with ACLs. There is no owner allowlist by default: any tailnet user (and sharee) gets an account. | [SSO docs, Trusted Header](https://github.com/open-webui/docs/blob/main/docs/features/authentication-access/auth/sso/index.mdx), [Tailscale tutorial](https://github.com/open-webui/docs/blob/main/docs/tutorials/auth-sso/tailscale.md), [`routers/auths.py:672-677`](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/auths.py) |
| **Home Assistant `trusted_networks`** | A login-page provider that trusts source IP/CIDR. `trusted_users` maps networks to users, and `allow_bypass_login` skips the page when one user is eligible. The result is an ordinary HA session (refresh token). Observed | IP is the credential. It cannot trust a network that is also in `trusted_proxies`, so it does not work behind a proxy that hides the client IP. Without the `homeassistant` provider as fallback, "anyone on your trusted network can log in by selecting a username". | [Auth providers](https://www.home-assistant.io/docs/authentication/providers/) |
| **t3code** | Tailscale is only a route: `t3 serve --tailscale-serve`, `t3 pair --tailscale`. Auth is always pairing: a one-time QR or link code turns into a scoped, revocable per-device session (cookie in browsers, bearer elsewhere). The headless LAN listener closes non-private peers, but "a pairing code is all that keeps other devices on them out". Observed | One pairing per device, then silent. Identity stays independent of route. The owner still has to get the first code onto the device. No tailnet-identity shortcut. | [`docs/user/remote-access.md`](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md), [`docs/internals/remote.md`](https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md), [`environment-auth.md`](https://github.com/pingdotgg/t3code/blob/main/docs/internals/environment-auth.md) |
| **Claude Code Remote Control and the Claude desktop app** | No inbound port: the local session polls the Anthropic API outbound. Any device signed in to the same claude.ai account sees connected sessions (QR to open on the phone). Optional **Trusted Devices**: a per-device enrolled key, offered only right after a full sign-in, plus a sign-in younger than 18 hours refreshed by Face ID/Touch ID/passkey. Observed | The account is the identity, and the vendor relays and stores transcripts. Trusted Devices adds device binding and a recency step-up. It needs a cloud identity provider that cairn does not have. | [Remote Control](https://code.claude.com/docs/en/remote-control#connection-and-security), [Trusted Devices](https://code.claude.com/docs/en/remote-control#trusted-devices), [Desktop: other devices](https://code.claude.com/docs/en/desktop#control-which-sessions-appear-on-your-other-devices) |
| **VS Code tunnels** | Both ends sign in with the same GitHub or Microsoft account. The tunnel is outbound to Azure dev tunnels with no local listener, and an SSH channel inside gives end-to-end encryption. Observed | Seamless on any device signed in to the account. Relies on a third-party relay and account. | [Remote Tunnels](https://code.visualstudio.com/docs/remote/tunnels) |
| **code-server** | `auth: password` with a random password in `~/.config/code-server/config.yaml` (argon2 `hashed-password` optional). Logins are rate-limited to 2/min + 12/h, and a cookie follows. No identity-proxy mode is built in. Observed | Paste once per browser. A single shared secret, no per-device revoke. | [FAQ](https://coder.com/docs/code-server/FAQ#how-do-i-change-the-password) |
| **Jupyter Server** | A token generated on start and printed in a `?token=` URL. After the first visit a cookie is set, so "you won't need to use the token again" until cookies clear or the port changes. A pluggable `IdentityProvider` exists. `allow_remote_access=False` returns 403 when `Host` is not local: an explicit DNS-rebinding defence. Observed | Same UX as cairn's login link. Host check covers loopback, not remote. | [Security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html), [`allow_remote_access`](https://jupyter-server.readthedocs.io/en/latest/other/full-config.html) |
| **Syncthing** | GUI/REST on `127.0.0.1:8384` by default ("you need to be logged in on the computer"). For network access it says set a username, a strong password and HTTPS. Binding a LAN address "will NOT restrict access to only devices on your local network". Observed | Treats the network as no boundary at all. The page for its Host-check option (`insecureSkipHostcheck`) returned 404 at fetch time, so that detail is unverified. | [GUI listen address](https://docs.syncthing.net/users/guilisten.html), [Security](https://docs.syncthing.net/users/security.html) |
| **cairn today** (`a2e2ebb51`) | Owner token as Bearer, `?token=` on SSE, a `#token=` login link, QR pairing for per-device tokens (owner-only management). The tsnet socket parses identity but does not admit on it. Observed | Safe, but every new browser needs the token. Pairing a browser requires an owner session first, a chicken-and-egg on a new device (inferred). | `apps/server/src/lib/token-auth.ts:78-110`, `routes-remote.ts:27-96` |

## 4. Threat model

| Actor | Header trust on TCP loopback (pre-#3073) | Identity on a 0600 Unix socket (tsnet sidecar or serve-to-socket) | Per-device token / cookie only |
|---|---|---|---|
| Any device or user on the tailnet, default allow-all policy (observed KB 1018) | Gets owner access only if its login is allowlisted. Without an allowlist, any user is in. | Same, plus owner match (§5) keeps other users out. | Needs a pairing code. |
| A **sharee** (another tailnet accepted a share) | Gets real identity headers (observed KB 1312) and is in if allowlisted. | Out: login ≠ owner login. The sidecar must also reject `ShareeNode` (Tailscale web client pattern, observed). | Needs a code. |
| A **tagged** device | No headers, so out (observed). | No headers, so out. | Can pair. |
| Same-uid local process (agents and lanes run as the owner) | Can forge the header. | Can connect to the 0600 socket and forge. | Can already read `~/.cairn/token` (0600, observed) and act as owner. |
| **Other-uid local process** (runner user, other accounts) | **Can forge the header**: the #2057 hole (observed). | Cannot connect to an owner-only 0600 socket (inferred from Unix permissions; root still can). | Cannot read the token file. |
| Malicious website opened in the owner's browser (**CSRF**) | The header is ambient (the proxy adds it), so a cross-site `fetch`/form POST lands as owner (inferred). | Same: ambient, so it needs a `Sec-Fetch-Site`/Origin check on state-changing requests (Tailscale web client, observed). | Bearer in `localStorage` is not ambient, so CSRF does not apply (inferred). An HttpOnly cookie would bring it back. |
| **DNS rebinding** against `127.0.0.1:8787` from a browser on the server host | Loopback grants nothing without a token, so it gets 401 (inferred). With `CAIRN_AUTH=off` the API is open to a rebinding page: cairn has no Host allowlist today (observed `git grep` finds no Host/Sec-Fetch check). Jupyter's `allow_remote_access` is the reference fix (observed). | The tailnet listener is HTTPS-only behind a `*.ts.net` certificate, so a rebound name fails TLS (inferred). | Same as the left column. |
| Funnel (public) | Serve sends no identity and strips forged headers (observed). | The sidecar runs a separate Funnel listener class with no identity (D103 §4). | The token is required. |

## 5. The pattern that fits cairn

**Tailscale web client model: identity from WhoIs, owner-only by default, on a listener only the proxy can reach, plus a CSRF gate. Pairing stays the fallback for everything else.**

Why this one:

1. **It is what Tailscale ships for exactly this case:** a self-hosted admin UI opened from the owner's other devices. Its rule, "untagged server: only the server node's own user", gives zero-config, excludes sharees and tagged nodes, and needs no allowlist (observed `client/web/auth.go:120-125,328-334`).
2. **It closes the #2057 hole without host firewall rules.** Trust is bound to the accepting socket (the listener class D103 already introduced), never to a header on TCP loopback (inferred).
3. **It is already 80% built on main.** The 0600 socket, the header strip and WhoIs in the sidecar, and the `tailnetIdentityOf` parser all exist (observed §2).
4. **Open WebUI's and Home Assistant's models are weaker for a single-owner box.** Open WebUI admits any login. HA trusts IPs and conflicts with proxies (observed).
5. **t3code and Claude Remote Control solve "new device" with pairing or a cloud account.** cairn keeps pairing (already merged) as the non-tailnet path. It skips a cloud account, which D103 rules out (no cairn-run server).

Rejected: a session cookie as the primary carrier. Per-request identity through the proxy already makes every request seamless, and a cookie only adds a second ambient credential to protect (inferred). The Tailscale web client needs its cookie only for the check-mode step-up. "Check mode" step-up itself is tailscale.com-only and its control API is internal (observed `controlSupportsCheckMode`). Not adopted (speculative: not needed for a single-owner tailnet).

## 6. Recommendation

### 6.1 Behaviour

- **R1. Tailnet owner admit.** On a request that arrived on the **tailnet listener class** (the 0600 Unix socket, `tailnetListenerOf(c) !== null`), admit as owner when the identity login equals the **owner login** and the request passes R3. Do not set `pairedDeviceId`, because this is the owner, not a paired device. On TCP loopback, never read `Tailscale-*` headers (keeps #3073).
- **R2. Owner login source, in order:**
  1. the sidecar reports `ownerLogin` (the tsnet node's own `UserProfile.LoginName`) in its `ready` message, which gives the zero-config Tailscale web client rule;
  2. else an explicit allowlist (reuse `CAIRN_TAILSCALE_USERS`, now honoured only on the socket class);
  3. else no tailnet admit, and the token gate as today.

  If the tsnet node is **tagged** (auth-key login), only the explicit allowlist applies, as in `toPeerCapabilities` for tagged servers.
- **R3. CSRF gate for ambient identity.** On the tailnet class, methods other than GET/HEAD/OPTIONS need `Sec-Fetch-Site: same-origin`, or an `Origin` equal to the tailnet origin (`tailnetOriginOf`). Copy `client/web/web.go:241-295`. WebSocket upgrades keep the existing same-origin and subprotocol check. Token/Bearer requests are exempt from R3, so CLI and agents keep working.
- **R4. Sidecar hardening.** Reject `Hostinfo.ShareeNode()` sources (no identity header). Add `ownerLogin` and `selfTagged` to `ready`. Keep the strip-all-`Tailscale-*` rule.
- **R5. System-tailscaled hosts without the sidecar (today's omarchy).** Offer a mode that opens the same 0600 tailnet socket without spawning tsnet, so the operator points `tailscale serve` at `unix:<CAIRN_HOME>/tsnet/tailnet.sock` instead of `127.0.0.1:8787`. Identity then comes from tailscaled's own header rewrite (observed `serve.go:998` runs on the Unix path). Owner login comes from LocalAPI `status` Self user (the socket is world-readable, observed), else the allowlist. Do not apply this repointing on omarchy without ian, because it changes the tailscale config.
- **R6. Web.** No gate change is needed on the happy path: `/api/teams` answers 200 and the gate never opens (observed `auth.ts` opens it only on 401). Add a small "signed in as `<login>` via Tailscale" line in Settings → Remote access, and let the owner create pairing codes from a tailnet-identity session (today `requireOwner` demands the Bearer token).
- **R7. Fallback, unchanged and still default-safe.** Not on a tailnet: owner token plus the login link, and QR pairing to per-device revocable tokens. A fresh home still serves no tailnet listener (D103 off-by-default test).
- **R8. Separate small fix.** Add a Host allowlist (loopback names plus the tailnet DNS name) when `CAIRN_AUTH=off`, against DNS rebinding (Jupyter pattern). It is independent of R1–R7.

### 6.2 Failure modes, tests first

| # | Failure | Required behaviour |
|---|---|---|
| A1 | Forged `Tailscale-User-Login` on TCP `127.0.0.1:8787` | 401 (regression guard for #2057) |
| A2 | Owner login on the tailnet socket, GET `/api/teams` | 200 without a token |
| A3 | Another user's login, or a sharee, on the socket | 401 |
| A4 | Tagged source (no header) on the socket | 401, then the token gate |
| A5 | Cross-site POST (`Sec-Fetch-Site: cross-site`) on the socket with the owner login | 403 |
| A6 | Sidecar `ready` without `ownerLogin` and no allowlist | No identity admit |
| A7 | Socket mode not `0600`, or owned by another uid | Refuse to start the listener (exists: `ensurePrivateDir` / `chmod`) |
| A8 | Owner-only routes (`/api/remote/pairing`, `enroll/confirm`) with tailnet owner identity | Allowed. With a paired-device token: 403, as today. |
| A9 | Funnel listener class with any `Tailscale-*` header | No identity admit |

### 6.3 Code areas

| Area | Change | Owner-routed security surface? |
|---|---|---|
| `apps/server/src/lib/token-auth.ts` | R1 admit branch and R3 CSRF check for the tailnet class | **Yes**: `credentials` |
| `apps/server/src/lib/tailnet-listener.ts` | Expose the listener class and owner login to the guard | No (`apps/*/src/**`), but it is the trust root, so review it with token-auth |
| `apps/server/src/routes-remote.ts` | `requireOwner` accepts tailnet owner identity (R6) | No |
| `apps/server/src/routes-machine.ts` (`enroll/confirm`) | Accept tailnet owner identity for approval from the owner's device | **Yes**: `machineAndCommandBoundary` |
| `apps/server/src/services/tsnet-remote.ts`, `lib/tsnet-sidecar.ts`, `config.ts` | Socket-only mode (R5), `ownerLogin` plumbing, `CAIRN_TAILSCALE_USERS` honoured only on the socket class | No, but `config.ts` startup warnings change text |
| `apps/tsnet-sidecar/internal/sidecar/{node,proxy,protocol}.go` | Sharee reject, `ownerLogin`/`selfTagged` in `ready` (R4) | No (Go module; CI under `.github/**` untouched) |
| `apps/web/src/routes/remote-access-page.tsx`, `api/auth.ts` | "Signed in via Tailscale" line, pairing from an identity session | No |
| `docs/deploy/tailscale-mobile.md`, `SECURITY.md` | Document serve → Unix socket and the owner rule | No |
| `apps/daemon/src/credentials.ts`, `machine-client.ts` | **No change.** Daemons keep the machine-token enrollment. | — |

These are D103 S2's unfinished admit step plus R4/R5. They touch `token-auth.ts` and `routes-machine.ts`, so the PR is owner-routed (`humanQueue.credentials` and `machineAndCommandBoundary` in `packages/shared/merge-gate-paths.json`, observed).

### 6.4 Main risk

The tailnet identity becomes an **ambient owner credential**. Two things break it:

- **CSRF (R3).** If the CSRF gate is missed on any state-changing route, a web page the owner visits can drive cairn as owner (inferred).
- **Who can connect to the socket.** Any process that can connect to the socket can claim any login. The trust root is "owner-only 0600 socket plus root". Same-uid agents already hold the token, so they gain nothing new (inferred). Any future change that widens the socket's mode or owner, or that re-adds header reads on TCP loopback, reopens #2057.

A2/A1/A5/A7 must stay in the test suite as guards.

## 7. Not verified

- The browser path from the Mac through a Unix-socket serve target was not run. Repointing serve would change the tailscale config, which this task forbids. Only the source path (`serve.go:695-697,998`) was read.
- Whether `tailscale serve unix:` works with the macOS App Store variant of tailscaled was not checked (speculative: likely not, given the sandbox note in KB 1312). It matters only if a Mac hosts the cairn server.
- The Syncthing Host-check doc page returned 404 at fetch time.
- The Claude desktop app has no separate "device linking" doc beyond Remote Control and Trusted Devices. Both are covered above.

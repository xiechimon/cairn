# Mobile remote access deployment: Tailscale Serve HTTPS

Your phone is the remote control: the server lives on an always-on host, and you reach it over a private tailnet. This route does not expose the service to the public internet. HTTPS is required for iOS web push and the PWA "Add to Home Screen" flow.

## Prerequisites

- An always-on host with Tailscale installed and signed in, visible in `tailscale status`.
- MagicDNS enabled in the tailnet admin console under DNS. Serve certificates use the MagicDNS name.
- The server and its private socket run as the owner. Tailscale Serve must run as that uid or root to reach the socket.

## 1. Run the server

The default TCP listener stays on `127.0.0.1:8787`. The first start generates a private access token at `<CAIRN_HOME>/token`; it survives restarts. Keep it as the fallback credential. `cairn token --rotate` replaces it; restart to apply the replacement. Do not put token values in shared logs or screenshots.

For a host already running system tailscaled, start the server with:

```sh
CAIRN_TSNET=socket npx @xiechimon/cairn
```

For a service, set `CAIRN_TSNET=socket` in its environment and restart it. This opens `<CAIRN_HOME>/tsnet/tailnet.sock` with mode `0600` in a private directory, without spawning the tsnet sidecar. The default `CAIRN_HOME` is `$HOME/.cairn`.

Owner identity is resolved from LocalAPI status: the profile in `User` matching `Self.UserID`, only when the backend is running and `Self` is untagged. The server refreshes that status every 30 seconds. If the owner is unavailable, an explicit comma-separated `CAIRN_TAILSCALE_USERS` allowlist applies on this socket only; otherwise the token gate remains. For a tagged server, only the explicit allowlist applies. A known untagged owner takes priority over the allowlist.

On Linux, LocalAPI is read through `/var/run/tailscale/tailscaled.sock`; on macOS, `/var/run/tailscaled.socket`. Failure to read status grants no implicit identity access. The macOS App Store variant and a real Mac-to-Unix-Serve browser path remain unverified.

`CAIRN_TSNET=1` retains embedded tsnet supervision instead. The sidecar supplies its own owner metadata and rejects sharee and tagged sources. With neither setting, no tailnet listener is created. Token auth must remain enabled for either listener arrangement.

## 2. Repoint Tailscale Serve after merge

**Operator action, deferred until this change merges. Do not run it as part of implementation or verification.** The coordinator applies the repoint on the deployment host, using that service's actual `CAIRN_HOME`:

```sh
tailscale serve --bg "unix:${CAIRN_HOME:-$HOME/.cairn}/tsnet/tailnet.sock"
tailscale serve status
```

Use `tailscale serve`, never `tailscale funnel`. Do not reset unrelated Serve configuration. Confirm the target in `tailscale serve status` is the private Unix socket, not `http://127.0.0.1:8787`.

The old loopback target remains a supported token-only fallback:

```sh
tailscale serve --bg http://127.0.0.1:8787
```

It never provides ambient owner login, even if identity headers are present.

## 3. Connect from the phone

1. Install Tailscale, sign in to the tailnet, and connect.
2. Open `https://<machine>.<tailnet>.ts.net/app` from another untagged device owned by the server's Tailscale user.
3. With the socket target active, `/api/teams` succeeds without a token; Settings → Remote access shows the signed-in login. The owner can create pairing codes and approve browser enrollment.
4. Use "Add to Home Screen" for the standalone PWA and iOS web push.

Other users, tagged sources, missing identity, self-requests without identity headers, and public traffic still need the access token or a QR-paired device token. Pairing remains per-device and individually revocable. Paired-device tokens cannot manage pairing or approve machine enrollment. An existing Bearer credential takes precedence over ambient identity, so a device token does not become an owner credential on the tailnet.

## Authentication boundary

The private accepting listener, not TCP peer address, establishes header trust. TCP loopback never reads Tailscale identity headers for admission, preserving #3073. Funnel identity is never admitted. The sidecar strips incoming `Tailscale-*` headers before adding WhoIs identity; system Serve must retain its own identity-header rewriting.

Any process that can reach the private socket can claim an identity. Mode `0600`, the owning uid, and its private parent directory are security boundaries. Same-uid processes and root are trusted; other local accounts are not. Startup refuses a socket owned by another uid or with a mode other than `0600`; do not widen permissions to make a proxy connect.

Ambient owner identity needs `Sec-Fetch-Site: same-origin` or an `Origin` equal to the tailnet origin for methods other than GET, HEAD and OPTIONS. Bearer-authenticated requests are exempt from that ambient CSRF check. Existing WebSocket same-origin and subprotocol checks remain required. No primary session cookie, cloud account or check-mode step-up is introduced.

## Public-internet alternative

For public access, use token or QR pairing authentication and terminate TLS in front of the server. Keep `CAIRN_TOKEN` configured on non-loopback binds. Tailscale Serve is the private route, not a substitute for public-entry authentication.

## Known pitfalls

- Local TUN-mode proxies can interfere with tailnet traffic. Add `100.64.0.0/10` to bypass or direct rules. On iOS, only one VPN-class tunnel can be active at a time.
- If the MagicDNS name does not resolve, confirm MagicDNS is enabled in the tailnet admin console.
- iOS web push reaches the installed PWA, not a regular browser tab.
- `tailscale serve reset` clears all Serve and Funnel configuration; do not use it for this repoint.

Design and verification limits: [seamless device authentication research](../research/seamless-device-auth-2026-11-08.md). The independent `CAIRN_AUTH=off` Host allowlist recommendation is outside this change.

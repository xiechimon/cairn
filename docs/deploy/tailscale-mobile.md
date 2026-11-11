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

Tailscale Serve only makes the server reachable. It does not sign the browser in. `CAIRN_TAILSCALE_USERS` is ignored and does not grant access. Another device signs in with a one-time pairing code from Remote access. A browser on the server machine exchanges a loopback bootstrap for an HttpOnly session and does not paste the owner token.

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
3. The phone sees the pairing page, not a signed-in Tailscale login. `/api/teams` is 401 until a pairing code is entered. Create that code on the server machine in Settings → Remote access, or with the owner token against `POST /api/remote/pairing`.
4. Use "Add to Home Screen" for the standalone PWA and iOS web push.

Tailscale only makes the server reachable. It does not sign the browser in. Pairing remains per-device and individually revocable. Paired-device tokens cannot manage pairing or approve machine enrollment.

## Authentication boundary

The private accepting listener, not TCP peer address, establishes header trust. TCP loopback never reads Tailscale identity headers for admission, preserving #3073. Funnel identity is never admitted. The sidecar strips incoming `Tailscale-*` headers before adding WhoIs identity; system Serve must retain its own identity-header rewriting.

Any process that can reach the private socket can claim an identity. Mode `0600`, the owning uid, and its private parent directory are security boundaries. Same-uid processes and root are trusted; other local accounts are not. Startup refuses a socket owned by another uid or with a mode other than `0600`; do not widen permissions to make a proxy connect.

A browser signs in with a pairing code or, on the Linux server machine, a loopback bootstrap. That becomes an HttpOnly session cookie. Cookie writes need same-origin proof. Bearer requests, including the owner token and device tokens, are exempt from that check. Tailscale identity headers do not admit a browser.

## Public-internet alternative

For public access, use token or QR pairing authentication and terminate TLS in front of the server. Keep `CAIRN_TOKEN` configured on non-loopback binds. Tailscale Serve is the private route, not a substitute for public-entry authentication.

## Known pitfalls

- Local TUN-mode proxies can interfere with tailnet traffic. Add `100.64.0.0/10` to bypass or direct rules. On iOS, only one VPN-class tunnel can be active at a time.
- If the MagicDNS name does not resolve, confirm MagicDNS is enabled in the tailnet admin console.
- iOS web push reaches the installed PWA, not a regular browser tab.
- `tailscale serve reset` clears all Serve and Funnel configuration; do not use it for this repoint.

Design and verification limits: [seamless device authentication research](../research/seamless-device-auth-2026-11-08.md). The independent `CAIRN_AUTH=off` Host allowlist recommendation is outside this change.

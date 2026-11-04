# Mobile remote access deployment: Tailscale Serve HTTPS

Your phone is the remote control: the server lives on an always-on host, and you reach the board from anywhere over a private tailnet. This route does not expose the service to the public internet.

## Overview

- Run the server on an always-on host and bind it to `127.0.0.1` (`HOST=127.0.0.1`). Only loopback is trusted to carry the Tailscale identity header.
- Use `tailscale serve` on that host to provide HTTPS at `https://<machine>.<tailnet>.ts.net` and proxy requests to the loopback server. iOS web push and the PWA "Add to Home Screen" flow both require HTTPS.
- Set `CAIRN_TAILSCALE_USERS` to the Tailscale user logins allowed to open Cairn without entering the access token. Keep the access token enabled as the fallback for every other request.
- Install Tailscale on the phone, sign in as an allowed user, open the HTTPS URL, then use "Add to Home Screen" for a standalone-app experience.
- Use `tailscale serve`, never `tailscale funnel`. Funnel exposes the service to the public internet and does not supply the identity header used for tokenless sign-in.

## Prerequisites

- An always-on host with Tailscale installed and signed in to your tailnet, visible in `tailscale status`.
- MagicDNS enabled in the tailnet admin console under DNS. Serve certificates use the MagicDNS name.
- The Tailscale login for each person allowed to use tokenless sign-in, such as `xiechimon@github`.

## Steps

### 1. Run the server on loopback

Create the access token once with the CLI; it is stored in `~/.cairn/token` and survives restarts. Then set the bind address and the comma-separated identity allowlist (whitespace around entries is ignored):

```sh
export HOST=127.0.0.1
export CAIRN_TAILSCALE_USERS=xiechimon@github
npx @xiechimon/cairn-cli token --rotate
npx @xiechimon/cairn
```

Confirm that `ss -tlnp | grep 8787` shows `127.0.0.1:8787`. The server logs a startup warning when `CAIRN_TAILSCALE_USERS` is set but the bind address is not loopback (`127.0.0.1`, `::1`, `localhost`); a non-loopback peer cannot use identity sign-in, even if it supplies the header. The startup log also prints a one-time login link that carries the token value — the link itself targets the host's loopback address, so from the phone type the token value into the token prompt instead; allowed identities never see that prompt at all.

### 2. Proxy HTTPS with Tailscale Serve

The proxy target must be the loopback URL, not the machine's tailnet address:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
curl -sSI https://<machine>.<tailnet>.ts.net/
```

Replace `<machine>.<tailnet>.ts.net` with your machine's MagicDNS name. Tailscale issues and renews the certificate automatically.

### 3. Connect from the phone

1. Install Tailscale on the phone, sign in as an allowed user, and connect to the tailnet.
2. Open `https://<machine>.<tailnet>.ts.net/app` in the browser. Cairn opens without the token prompt when Tailscale Serve supplies that user's identity.
3. Use "Add to Home Screen" and launch Cairn from that icon for the standalone PWA and iOS web push.

## Authentication boundary

Cairn trusts `Tailscale-User-Login` only when the login is allowlisted and the direct TCP peer is loopback. This matches a same-host `tailscale serve` proxy: Serve removes client-supplied identity headers from incoming requests and fills them with the authenticated tailnet identity, so a device cannot spoof the header through the proxy, and a tailnet device that connects directly to a non-loopback listening port fails the loopback check and still needs the token.

The header value must equal an allowlist entry exactly. A login containing non-ASCII characters arrives RFC2047-encoded (`=?utf-8?q?...?=`) and does not match a plain entry, so allowlist ASCII logins.

Do not put another header-forwarding reverse proxy on the same host while the identity allowlist is on. Such a proxy connects to the server from loopback and would forward client-supplied `Tailscale-User-Login` values, turning every device that can reach the proxy into the allowlisted user. `tailscale serve` is safe because it strips those headers itself; any other same-host proxy in the path must remove them before forwarding.

Requests without an allowlisted identity still require the access token. This includes unknown users, direct non-loopback connections, tagged devices, and Funnel traffic. Keep the token configured even when everyone normally signs in through Tailscale Serve.

## Public-internet alternative

For public team access without an always-on host, use the Railway deployment with its public HTTPS domain and `CAIRN_TOKEN`. Tailscale Serve is the private, single-tailnet route; Railway is the public route.

## Known pitfalls

- A local TUN-mode proxy can interfere with tailnet traffic. Add `100.64.0.0/10` to its bypass or direct rules. On iOS, only one VPN-class tunnel can be active at a time.
- If the MagicDNS name does not resolve, confirm that MagicDNS is enabled in the tailnet admin console.
- iOS web push reaches the installed PWA, not a regular browser tab.
- `tailscale serve reset` clears all Serve and Funnel configuration. Reconfigure Serve after using it.

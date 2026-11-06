# Mobile remote access deployment: Tailscale Serve HTTPS

Your phone is the remote control: the server lives on an always-on host, and you reach the board from anywhere over a private tailnet. This route does not expose the service to the public internet.

## Overview

- Run the server on an always-on host and bind it to `127.0.0.1` (the default).
- Use `tailscale serve` on that host to provide HTTPS at `https://<machine>.<tailnet>.ts.net` and proxy requests to the loopback server. iOS web push and the PWA "Add to Home Screen" flow both require HTTPS.
- Sign in on the phone with the access token. Tokenless sign-in through the `Tailscale-User-Login` header was removed (#2057): any process on the loopback interface can forge that header, so it grants nothing. Identity sign-in will return through a dedicated tailnet listener in a later release.
- Install Tailscale on the phone, connect to the tailnet, open the HTTPS URL, enter the token once, then use "Add to Home Screen" for a standalone-app experience.
- Use `tailscale serve`, never `tailscale funnel`. Funnel exposes the service to the public internet.

## Prerequisites

- An always-on host with Tailscale installed and signed in to your tailnet, visible in `tailscale status`.
- MagicDNS enabled in the tailnet admin console under DNS. Serve certificates use the MagicDNS name.

## Steps

### 1. Run the server on loopback

The first start generates the access token and stores it in `~/.cairn/token`; it survives restarts. `cairn token` prints it, `cairn token --rotate` replaces it:

```sh
npx @xiechimon/cairn
```

Confirm that `ss -tlnp | grep 8787` shows `127.0.0.1:8787`. `CAIRN_TAILSCALE_USERS` has no effect any more; if it is still set, the server logs a startup warning saying it is ignored. The startup log prints a one-time login link that carries the token value; the link targets the host's loopback address, so from the phone type the token value into the token prompt instead.

### 2. Proxy HTTPS with Tailscale Serve

The proxy target must be the loopback URL, not the machine's tailnet address:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
curl -sSI https://<machine>.<tailnet>.ts.net/
```

Replace `<machine>.<tailnet>.ts.net` with your machine's MagicDNS name. Tailscale issues and renews the certificate automatically.

### 3. Connect from the phone

1. Install Tailscale on the phone, sign in to your tailnet, and connect.
2. Open `https://<machine>.<tailnet>.ts.net/app` in the browser and enter the access token when prompted.
3. Use "Add to Home Screen" and launch Cairn from that icon for the standalone PWA and iOS web push.

## Authentication boundary

Every `/api/*` request needs the access token. The `Tailscale-User-Login` header is not read: Tailscale Serve proxies from loopback, so the server cannot tell a header filled by Serve from one forged by another local process or by a second reverse proxy on the same host. Keep the token private and rotate it with `cairn token --rotate` if it leaks.

## Public-internet alternative

For public team access instead of a tailnet, run the same container image on any host with a public address, set `CAIRN_TOKEN`, and terminate TLS in front of it with a reverse proxy. Tailscale Serve is the private, single-tailnet route; this is the public one.

## Known pitfalls

- A local TUN-mode proxy can interfere with tailnet traffic. Add `100.64.0.0/10` to its bypass or direct rules. On iOS, only one VPN-class tunnel can be active at a time.
- If the MagicDNS name does not resolve, confirm that MagicDNS is enabled in the tailnet admin console.
- iOS web push reaches the installed PWA, not a regular browser tab.
- `tailscale serve reset` clears all Serve and Funnel configuration. Reconfigure Serve after using it.

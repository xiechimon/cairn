# Mobile remote access deployment: Tailscale Serve HTTPS

Your phone is the remote control: the server lives on an always-on host, and you reach the board from anywhere over a private tailnet. This route does not expose the service to the public internet.

## Overview

- Run the server on an always-on host and bind it to `127.0.0.1` (`HOST=127.0.0.1`). TCP always requires the access token. Add an owner-only Unix socket for identity sign-in.
- Use `tailscale serve` on that host to provide HTTPS at `https://<machine>.<tailnet>.ts.net` and proxy requests to the Unix socket. iOS web push and the PWA "Add to Home Screen" flow both require HTTPS.
- Set `CAIRN_TAILSCALE_USERS` to the Tailscale user logins allowed to open Cairn without entering the access token. Keep the access token enabled as the fallback for every other request.
- Install Tailscale on the phone, sign in as an allowed user, open the HTTPS URL, then use "Add to Home Screen" for a standalone-app experience.
- Use `tailscale serve`, never `tailscale funnel`. Funnel exposes the service to the public internet and does not supply the identity header used for tokenless sign-in.

## Prerequisites

- An always-on host with Tailscale installed and signed in to your tailnet, visible in `tailscale status`.
- MagicDNS enabled in the tailnet admin console under DNS. Serve certificates use the MagicDNS name.
- The Tailscale login for each person allowed to use tokenless sign-in, such as `xiechimon@github`.

## Steps

### 1. Run the server with a private Unix socket

Create the access token once with the CLI; it is stored in `~/.cairn/token` and survives restarts. Then create a private socket directory and set the TCP bind address, socket path and comma-separated identity allowlist (whitespace around entries is ignored):

```sh
install -d -m 700 "$HOME/.cairn/run"
export HOST=127.0.0.1
export CAIRN_TAILSCALE_SOCKET="$HOME/.cairn/run/server.sock"
export CAIRN_TAILSCALE_USERS=xiechimon@github
npx @xiechimon/cairn-cli token --rotate
npx @xiechimon/cairn
```

Confirm that `ss -tlnp | grep 8787` shows `127.0.0.1:8787` and `stat -c '%a %U' "$CAIRN_TAILSCALE_SOCKET"` shows `600` and the server user. The socket path must be absolute; its parent must not be writable by group or others. Existing non-sockets and foreign-owned sockets are refused. Only an inactive socket owned by the server user can be removed on restart. An active listener is refused.

With an allowlist but no socket, the server emits one startup warning and never trusts identity headers on TCP. The token login link printed at startup remains a fallback; keep the token available before changing an existing deployment.

### 2. Proxy HTTPS with Tailscale Serve

Tailscale 1.104 supports `unix:` targets. Run Serve as root, which can connect to the owner-only socket:

```sh
sudo tailscale serve --bg "unix:$CAIRN_TAILSCALE_SOCKET"
tailscale serve status
curl -sSI https://<machine>.<tailnet>.ts.net/
```

Replace `<machine>.<tailnet>.ts.net` with your machine's MagicDNS name. Tailscale issues and renews the certificate automatically.

For an existing TCP-proxy deployment:

1. Obtain the current access token with `cairn token` and keep a token-authenticated session available.
2. Create the private directory and set `CAIRN_TAILSCALE_SOCKET` and `CAIRN_TAILSCALE_USERS` in the server service environment, retaining the token configuration.
3. Restart the server, verify the socket's owner and `600` mode, and verify a bearer-authenticated TCP API request succeeds. Until Serve is repointed, its TCP requests require the token.
4. Repoint Serve with the `sudo tailscale serve --bg "unix:$CAIRN_TAILSCALE_SOCKET"` command above, then verify the HTTPS URL from an allowed tailnet device and an unknown identity. If identity sign-in fails, use the token fallback while inspecting the socket and Serve status.

### 3. Connect from the phone

1. Install Tailscale on the phone, sign in as an allowed user, and connect to the tailnet.
2. Open `https://<machine>.<tailnet>.ts.net/app` in the browser. Cairn opens without the token prompt when Tailscale Serve supplies that user's identity.
3. Use "Add to Home Screen" and launch Cairn from that icon for the standalone PWA and iOS web push.

## Authentication boundary

Cairn trusts `Tailscale-User-Login` only for an exactly allowlisted login on the dedicated Unix listener. TCP identity headers are ignored on every address, including IPv4 and IPv6 loopback. Forwarding headers cannot change this boundary. TCP API clients and scripts must send their bearer token; daemon machine endpoints retain their separate machine credentials.

The Unix socket is mode `0600`, owned by the server user. Root-run Tailscale Serve can connect; other Unix users cannot. This does not isolate the server from root or processes running as the server user: those processes can access the socket and assert identity. Do not expose the socket through another proxy that forwards arbitrary identity headers. Serve must supply the authenticated identity itself.

The header value must equal an allowlist entry exactly. A login containing non-ASCII characters arrives RFC2047-encoded (`=?utf-8?q?...?=`) and does not match a plain entry, so allowlist ASCII logins.

Requests without an allowlisted socket identity still require the access token. This includes unknown users, direct TCP connections, tagged devices and Funnel traffic. Keep the token configured even when everyone normally signs in through Tailscale Serve. With token authentication explicitly disabled, the existing open local/development behavior remains open.

## Public-internet alternative

For public team access without an always-on host, use the Railway deployment with its public HTTPS domain and `CAIRN_TOKEN`. Tailscale Serve is the private, single-tailnet route; Railway is the public route.

## Known pitfalls

- A local TUN-mode proxy can interfere with tailnet traffic. Add `100.64.0.0/10` to its bypass or direct rules. On iOS, only one VPN-class tunnel can be active at a time.
- If the MagicDNS name does not resolve, confirm that MagicDNS is enabled in the tailnet admin console.
- iOS web push reaches the installed PWA, not a regular browser tab.
- `tailscale serve reset` clears all Serve and Funnel configuration. Reconfigure Serve after using it.

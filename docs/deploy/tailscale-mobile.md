# Use Cairn on your devices over Tailscale

Keep one Cairn server on your computer and open it from your own phone or another computer. Tailscale carries the private connection; Cairn still requires device pairing. No Cloudflare account, public gateway or router port forwarding is needed. The server computer must stay awake and online.

## 1. Start Cairn on the server computer

Install Node.js 22 or 24, then run:

```sh
npx @xiechimon/cairn
```

Open `http://127.0.0.1:8787/app` on that computer. Keep authentication enabled: do not set `CAIRN_AUTH=off`. Cairn stores its database and owner token under `~/.cairn` by default (`CAIRN_HOME` overrides it). Keep the owner token private.

A Linux browser on the server computer can sign in through the local bootstrap. If the local browser asks for a pairing code, create one in the server terminal:

```sh
curl -s -X POST \
  -H "Authorization: Bearer $(npx @xiechimon/cairn-cli token | head -1)" \
  http://127.0.0.1:8787/api/remote/pairing
```

Enter the returned `code` on Cairn's pairing page. With an explicit `CAIRN_TOKEN`, use that configured owner token instead of the file. Pairing codes expire and work only once; never share them publicly.

## 2. Enable private HTTPS

Install Tailscale on the server computer, sign in, and connect. In the Tailscale admin console, enable MagicDNS and HTTPS certificates under DNS. Then, on the server computer:

```sh
tailscale status
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

If Serve prints an enablement link, open it, enable Serve, and run the command again. Copy the HTTPS address printed by Serve, for example `https://<machine>.<tailnet>.ts.net`. The target should be the running Cairn server on loopback. Do not use Funnel: that publishes a service to the internet. Do not run `tailscale serve reset`, which removes unrelated Serve configuration.

This is the simplest supported setup. An existing `CAIRN_TSNET=1` embedded-sidecar installation can remain as it is; it is not required for this guide. Do not restart or reconfigure an already working server just to follow this guide.

## 3. Pair your phone or another browser

1. Install Tailscale on the other device, sign in to the same tailnet, and connect. Tailnet access rules must allow access to the server's HTTPS port.
2. On the server computer, open Cairn's Settings → Remote access and create a pairing code. The terminal command in step 1 is the fallback.
3. On the other device, open the HTTPS address from Serve with `/app` appended. Enter the pairing code and name the device. The browser keeps an HttpOnly session cookie; a Tailscale login alone does not sign you in to Cairn.
4. On iPhone, optionally use Safari's Add to Home Screen. iOS web push requires the installed web app, not an ordinary browser tab.

Only pair your own devices. A paired device can approve a new Runner. **A lost paired device can approve machines until you revoke that device.** Use the owner session on the server computer → Settings → Remote access to revoke it. Also revoke any Runner it already approved: revoking a browser does not revoke previously enrolled machines. Pairing-code creation, device revocation and credential administration still require the owner token/session.

## 4. Add another computer as a Runner

Opening Cairn in a browser does not register that computer for agent work. On the computer that should run tasks, install Node.js 22 or 24 and Tailscale, connect to the same tailnet, then run:

```sh
npm install -g @xiechimon/cairn-cli@latest
cairn start --server https://<machine>.<tailnet>.ts.net
```

Replace the example address with the server's HTTPS address. Alternatively, open Cairn **at that HTTPS address**, choose Add Runner, and copy its commands. Do not copy a loopback address to another computer: `127.0.0.1` on that computer is not your Cairn server.

Open the printed approval URL in a paired browser, including your phone, and approve the intended Runner. Use the Tailscale HTTPS URL for approval too, not the server's loopback URL. Wait until the Runner appears online. Its credentials are saved for later `cairn start` calls. Approval under the server's own hostname still requires the owner session: it can replace the local Runner's credential. A headless Runner can instead use the API-key command shown under Add Runner; creating that key requires the owner session.

Connect your model as described in [getting started](../getting-started.md#use-your-claude-subscription-on-your-machines), select the online Runner, and send a small task. The model and tools use your own server/Runner and credentials, not a Cairn-hosted gateway.

## If it does not connect

- No page: confirm both devices are connected to Tailscale, the server is awake, and `tailscale serve status` still points at Cairn.
- Hostname does not resolve: enable MagicDNS and check tailnet access rules. Use the HTTPS hostname from Serve, not a raw IP address.
- Pairing refused: mint a fresh code in the owner session; codes are single-use. A revoked device must pair again.
- Runner stays offline: check its `--server` address and Tailscale connection, finish approval, then run `cairn status` or `cairn logs -f` on that computer.
- A VPN or TUN-mode proxy interferes: allow tailnet traffic (`100.64.0.0/10`) to go directly. iOS permits only one VPN-class tunnel at a time.

Tailscale identity headers never replace Cairn authentication. Cookie writes require same-origin proof. Background service setup and model/runtime requirements are in [getting started](../getting-started.md); other settings are in [configuration](../configuration.md).

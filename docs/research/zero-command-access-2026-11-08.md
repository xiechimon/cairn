# Zero-command access from all of the owner's devices (2026-11-08)

Publication note: restored historical research, with private details redacted. Evidence labels describe the original research session; recommendations are not implementation approval or current policy.

> **Question.** How do self-hosted apps let a user reach their own instance from every device they own (browser and phone) with no terminal commands, no sudo and no manual proxy config? Check the proposal "embed tsnet by default, with a one-click **Connect with Tailscale** button" against how other products actually do it, then pick one path for cairn.
>
> **Marks.** **`measured`**: read first-hand this session (official doc page, source at a named ref, command output, or the running product). **`inferred`**: derived from `measured` and checkable. **`unverified`**: everything else.
>
> **Refs.** cairn at `origin/main` `2ff7e8761`. Tailscale source at `v1.104.5` (Go module cache, the version `apps/tsnet-sidecar` pins). t3code `main` `ade473018`, `docs/user/remote-access.md` last changed in `d520d5bb8`. openai/codex `main` `9ba7a3df5`. The server host runs tailscaled 1.104.2.
>
> **Builds on.** [`remote-access-tsnet.md`](remote-access-tsnet.md) (D103: the user's own Tailscale account, no cairn-run server), [`seamless-device-auth-2026-11-08.md`](seamless-device-auth-2026-11-08.md) (tailnet owner identity, shipped in #3440) and [`docs/deploy/tailscale-mobile.md`](../deploy/tailscale-mobile.md).
>
> **Method note.** The `agent-reach web` channel hit a one-hour rate limit (`RATE_LIMITED`, "retry later"). Pages were then fetched with `curl` and stripped to text. Nabu Casa's support site sits behind a Cloudflare JavaScript challenge, so it was read in the owner's Chrome. GitHub sources were read with `gh api`.

## 1. What cairn needs today, measured

| Fact | Mark | Source |
|---|---|---|
| the owner's box needs two manual steps: `CAIRN_TSNET=socket` in the service env, and `tailscale serve --bg unix:…/tailnet.sock` (root or operator). Serve on the host now points at `unix:<HOME>/.cairn/tsnet/tailnet.sock`. | `measured` | `docs/deploy/tailscale-mobile.md` §1-2; `tailscale serve status` |
| `CAIRN_TSNET=1` already spawns the Go sidecar, which emits `authUrl`, reports `ownerLogin`/`selfTagged`, opens `ListenTLS(":443")` and rejects tagged and sharee peers. | `measured` | `apps/tsnet-sidecar/internal/sidecar/node.go`, `run.go:153-175` |
| The Remote access page already shows `请先登录 Tailscale：{url}` when the sidecar is in `needs-login`. It is shown as text, not a button, and the sidecar only starts when an env var is set. | `measured` | `apps/web/src/routes/remote-access-page.tsx:121-180`; `apps/server/src/config.ts:206` |
| The sidecar binary built from `origin/main` for linux/amd64 is 32,691,423 bytes. | `measured` | `go build` in a scratch directory |
| Run with a fresh state dir, the sidecar printed `LocalBackend state is NeedsLogin; running StartLoginInteractive...` and emitted `{"type":"authUrl"}` with a `login.tailscale.com/a/…` URL. It exits as soon as its stdin closes. | `measured` | scratch run; process stopped before sign-in, no node was added (`tailscale status` has no such node) |
| Opening that URL shows "Log in to connect a device to your tailnet": email, Google, Microsoft, GitHub, Apple, passkey, plus "Alternatively, use a QR code". The sign-in was not completed, because passwords and 2FA are the owner's to enter. | `measured` | [screenshot](zero-command-access-2026-11-08/tsnet-authurl-login.jpg) |
[Redacted: private measurements.]

## 2. Tailscale facts that decide "one click"

| Fact | Mark | Source |
|---|---|---|
| tsnet auth order: auth key, then OAuth client secret or workload identity, then an interactive login URL. With device approval on, an admin must also approve the node. | `measured` | [KB 1244 tsnet](https://tailscale.com/kb/1244/tsnet); `tsnet/tsnet.go:45-72` |
| **`ListenTLS` refuses to start** without MagicDNS (`you must enable MagicDNS…`) or without HTTPS enabled (`you must enable HTTPS in the admin panel…`). | `measured` | `tsnet/tsnet.go:1458-1471` |
| The `tailscale serve` CLI recovers from that through a consent URL: `enableFeatureInteractive(ctx, "serve", HTTPS)` uses LocalAPI `QueryFeature`. tsnet's `LocalClient()` exposes the same `QueryFeature`, so the sidecar can surface the same consent link. | `measured` CLI and client code; `inferred` that it works on a tsnet node | `cmd/tailscale/cli/serve_v2.go:473`, `client/local/local.go:1420`; [KB 1312](https://tailscale.com/kb/1312/serve) "prompts you to allow Tailscale to enable HTTPS on your behalf" |
| MagicDNS is on by default for tailnets created after 2022-10-20. HTTPS is a separate admin switch ("Under HTTPS Certificates, select Enable HTTPS"), and enabling it publishes machine names in Certificate Transparency logs. | `measured` | [KB 1081](https://tailscale.com/kb/1081/magicdns), [KB 1153](https://tailscale.com/kb/1153/enabling-https) |
| Node keys expire after 180 days by default. After that, "connections to/from the given endpoint will stop working" until re-authentication, or until an admin disables key expiry for that device. Tagged devices have expiry off by default. | `measured` | [KB 1028](https://tailscale.com/kb/1028/key-expiry) |
| A duplicate hostname becomes `<hostname>-1`. | `measured` | [KB 1098](https://tailscale.com/kb/1098/machine-names) |
| Phone setup: install the app, tap Get Started, accept the VPN configuration prompt, then sign in with an SSO provider. Android also shows a QR code plus a code for login. | `measured` | [KB 1020 iOS](https://tailscale.com/kb/1020/install-ios), [KB 1079 Android](https://tailscale.com/kb/1079/install-android) |
| **iOS and Android run only one VPN at a time.** | `measured` | [KB 1105](https://tailscale.com/kb/1105/other-vpns) |
| Personal plan: $0, free for non-commercial use, unlimited user devices, up to 6 users. A tailnet created with a public-domain account (Gmail, Apple, personal GitHub) joins it automatically. A custom-domain sign-up starts a 14-day trial. After that, "new users and devices cannot become active" until a plan is chosen. | `measured` | [pricing](https://tailscale.com/pricing) FAQ |

## 3. Comparison: what the user does

Click counts below assume the user is already signed in to their identity provider (IdP) in that browser. "Vendor cloud" means a service the app's vendor runs in the data path or identity path.

| Product | Installs (server / each device) | Clicks, typed values, commands | Identity | Vendor cloud | Phones | Failure modes | Mark, link |
|---|---|---|---|---|---|---|---|
| **Tailscale tsnet apps: golink, tclip, tsidp** | One binary or container / the Tailscale app | Create an **auth key** in the admin console (tag it, not ephemeral), then pass `TS_AUTHKEY` on first run. tclip: "you *must* set either `TS_AUTHKEY`… or run it with `--tsnet-verbose` to get the login URL". tsidp also needs MagicDNS, HTTPS and an ACL capability grant. Several typed values, one command. | Tailnet `WhoIs`, per request | Tailscale control plane | Through the Tailscale app | Ephemeral key deletes the node. HTTPS cert takes "a few minutes" on first run. | `measured` [golink](https://github.com/tailscale/golink#running), [tclip](https://github.com/tailscale-dev/tclip), [tsidp](https://github.com/tailscale/tsidp) |
| **Home Assistant + Nabu Casa** | Nothing extra / Companion app | Settings → Home Assistant Cloud → sign in → **one toggle**. The first enable waits for a certificate. Phone app: LAN discovery, or type the remote URL, then the HA login. | HA's own user and password per device; the Cloud account only enables the relay | Yes (paid). SniTun TCP relay; TLS terminates on the HA box with a local Let's Encrypt key | Native app | Paid subscription; "not even Nabu Casa can restore access" if the key is lost | `measured` [enable](https://support.nabucasa.com/hc/en-us/articles/26474279202973), [security](https://support.nabucasa.com/hc/en-us/articles/26508882007581), [companion](https://companion.home-assistant.io/docs/getting_started/) |
| **Home Assistant Tailscale add-on** | Add-on / the Tailscale app | Install, Start, open the add-on Web UI to sign in (docs warn some browsers fail this step). For HTTPS: admin DNS page → choose tailnet name, MagicDNS, **Enable HTTPS**; HA → trust X-Forwarded-For and add `127.0.0.1` to trusted proxies; restart. Docs: "Consider disabling key expiry". About 10 clicks across two consoles. | HA login on top. Identity headers are not used. | Tailscale | Tailscale app, or **Funnel** for "devices without installed Tailscale VPN client" | Key expiry; HTTPS off; proxy trust; Funnel takes "up to 10 minutes" | `measured` [add-on DOCS.md](https://github.com/hassio-addons/addon-tailscale/blob/main/tailscale/DOCS.md) |
| **Plex** | Server / Plex apps | First setup at `http://127.0.0.1:32400/web` on the server, signed in to a Plex account. Remote Access tries UPnP/NAT-PMP automatically, else a manual port forward. | plex.tv account on server and apps | Yes: plex.tv account, and **Relay** when a direct connection fails (2 Mbps cap) | Apps sign in to the account | Double NAT, CG-NAT, relay bitrate cap, remote playback paywall | `measured` [remote access](https://support.plex.tv/articles/200289506-remote-access/), [relay](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/), [install](https://support.plex.tv/articles/200288586-installation/). The "sign in with a code" page returned 404 (blocked). |
| **Jellyfin** | Server / apps | LAN: auto-discovery. Remote: port forward, reverse proxy or VPN, done by the user. **Quick Connect**: the new device shows a code, and an already signed-in device enters it. | Local accounts | None | Apps; remote access is self-built | "Opening a port directly to the Internet is therefore insecure" | `measured` [networking](https://jellyfin.org/docs/general/post-install/networking/), [Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/) |
| **Immich** | Server / mobile app | Type the server URL (`http://<ip>:2283`) and email/password into the app. Remote: VPN, Tailscale or reverse proxy, done by the user. | Local accounts | None | App, plus Tailscale if remote | "Tailscale needs to be installed and running on both server-side and client-side" | `measured` [mobile](https://immich.app/docs/features/mobile-app), [remote](https://immich.app/docs/guides/remote-access) |
| **Syncthing** | Syncthing on each device | "Add Remote Device" on **both** devices and enter the other's 52-character device ID. | Device ID = SHA-256 of the device certificate, mutual TLS | Public discovery and relay servers run by the project (relay sees IP and traffic volume; data stays end-to-end encrypted) | Android app | Mutual add needed; local discovery is not authenticated | `measured` [getting started](https://docs.syncthing.net/intro/getting-started.html), [device IDs](https://docs.syncthing.net/dev/device-ids.html), [relaying](https://docs.syncthing.net/users/relaying.html) |
| **t3code** | Desktop app or `t3` / app or browser | **T3 Connect**: Settings → Sharing & access → sign in → enable. Other device: sign in to the same account and pick the machine. Headless: `t3 up` prints a link and a short code to approve. LAN or tailnet: one-time pairing QR or link. Tailscale HTTPS: a toggle that drives the **system** `tailscale` CLI, not tsnet. | T3 Connect account, or a pairing code turned into a per-device session | Yes for T3 Connect (3 machines free, more on paid T3 Chat) | Native app, or app.t3.codes (HTTPS endpoint required) | "A pairing code is all that keeps other devices on them out" on LAN | `measured` [remote-access.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md); tsnet not used: [desktop-app-stack research](desktop-app-stack-2026-11-08.md) row "t3code remote access" |
| **OpenCode** | `opencode web` / browser | Optional `--mdns` (`opencode.local`). Set `OPENCODE_SERVER_PASSWORD` for HTTP basic auth: "If … not set, the server will be unsecured". No tunnel. | Shared password | None | Browser on LAN | No remote path, single password | `measured` [web](https://opencode.ai/docs/web/), [server](https://opencode.ai/docs/server/) |
| **Codex remote control** | Codex CLI or app / ChatGPT clients | `codex remote-control` starts the daemon; `codex remote-control pair` prints "a short-lived manual pairing code". | ChatGPT account (`uses_codex_backend() && account_id`) plus pairing | Yes: an outbound WebSocket to the OpenAI backend (`websocket_url`, `enroll_url`, `pair_url`) | ChatGPT apps | No ChatGPT login means no remote | `measured` [`remote_control_cmd.rs`](https://github.com/openai/codex/blob/main/codex-rs/cli/src/remote_control_cmd.rs), [`remote_control/auth.rs`](https://github.com/openai/codex/blob/main/codex-rs/app-server-transport/src/transport/remote_control/auth.rs), `protocol.rs` |
| **Claude Code Remote Control** | Claude Code / Claude app or browser | `claude remote-control` (one-time `Enable Remote Control? (y/n)`), or `/remote-control` in a session. Space bar shows a QR code. | claude.ai account (Pro and above; "API keys are not supported"). Optional Trusted Devices: per-device key plus an 18-hour biometric step-up. | Yes: "outbound HTTPS requests only and never opens inbound ports". Transcripts are stored on Anthropic servers. | Native app | No eligible plan; laptop asleep | `measured` [remote-control](https://code.claude.com/docs/en/remote-control) |
| **VS Code Remote Tunnels** | `code tunnel` (or a desktop UI click) / vscode.dev or VS Code | Start the tunnel and sign in to GitHub or Microsoft once. Client: open `vscode.dev/tunnel/<machine>`, then GitHub OAuth. `code tunnel service install` for always-on. | Same GitHub or Microsoft account on both ends | Yes: Azure dev tunnels, "no firewall changes… doesn't set up any network listeners"; SSH inside for end-to-end encryption | Browser (vscode.dev) | 10 tunnels per account, bandwidth limits | `measured` [Remote Tunnels](https://code.visualstudio.com/docs/remote/tunnels) |
| **Coder** | `coder server` / browser or CLI | With no `CODER_ACCESS_URL`, "Coder will create a publicly accessible URL to reverse proxy your deployment". The first user signs up in the browser. Workspace traffic is direct WireGuard (STUN) or relayed through the control plane. | Coder accounts (OIDC optional) | Coder-run tunnel for the zero-config URL | Browser | Tunnel is meant for simple setup only | `measured` [setup](https://coder.com/docs/admin/setup), [networking](https://coder.com/docs/admin/networking) ("Tailscale's open source backs our … networking") |
| **code-server** | code-server / browser | Copy the password from `~/.config/code-server/config.yaml`. Remote: SSH port forward, or Caddy plus Let's Encrypt with `sudo` commands. | Shared password | None | iPad via a public HTTPS domain | sudo, DNS and port 80/443 exposure | `measured` [guide](https://coder.com/docs/code-server/guide) |
| **Cloudflare Quick Tunnel / ngrok** (contrast) | `cloudflared` or `ngrok` / nothing | `cloudflared tunnel --url http://localhost:8080`: no account, random `trycloudflare.com` URL. `--allowed-mail` adds an email one-time PIN. ngrok: account plus `ngrok config add-authtoken`, then a free dev domain and an optional Google OAuth gate. | None by default; email OTP or OAuth at the edge | Yes, in the data path | Any browser, no app | Public URL. Quick Tunnels have "no uptime guarantee", 200 in-flight requests and **no SSE**. Access ends when the process stops. | `measured` [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), [ngrok quickstart](https://ngrok.com/docs/share-localhost/quickstart.md) |

### Patterns (`inferred` from the table)

1. **Account relay** (Nabu Casa, Plex, t3code T3 Connect, Codex, Claude RC, VS Code, Coder's tunnel) is the only family that reaches a phone with **no VPN app and no network setup**. Every member runs a vendor service, so D103 excludes it for cairn: no cairn-run server.
2. **Tailscale-embedded** (HA add-on, tsnet apps) is zero-command for the server once the login is done in a browser. Every source also lists the same follow-ups: enable HTTPS, think about key expiry, and the device needs the Tailscale app. Tailscale's own tsnet apps document auth keys plus tags because they are shared servers, not one user's tool.
3. **Pairing** (Jellyfin Quick Connect, t3code LAN, Syncthing, Codex) solves "which device is this", never "how does it reach the server". Every pairing product pairs over a route that already exists (LAN, a tunnel, or an account relay).
4. Nobody in the set does "one click and every phone just works" without either a vendor relay or a VPN app on the phone.

## 4. The proposal, checked

"Embed tsnet as the default with a one-click Connect with Tailscale button."

| Claim inside the proposal | Verdict | Evidence |
|---|---|---|
| No sudo, no system Tailscale needed on the server | **Holds.** tsnet is userspace in the user's own process; the sidecar ran as `the owner` with a private state dir. | `measured` scratch run |
| One click | **No: 1 click in cairn plus 2-4 at Tailscale**, and one more consent step on tailnets without HTTPS. | `measured` login page; `tsnet.go:1467-1471`; KB 1153 |
| The owner is recognised with no allowlist | **Holds for interactive login only.** An interactive node is untagged and owned by the user, so the sidecar's `ownerLogin` matches. An auth-key or tagged node loses that (`selfTagged` means allowlist only). | `measured` `node.go:57-72`; `docs/deploy/tailscale-mobile.md` §1 |
| It keeps working | **Breaks after 180 days** unless the user re-authenticates or disables key expiry for the node. HA's add-on documents the same chore. | `measured` KB 1028, HA DOCS.md |
| The phone works with zero commands | **Only if the phone runs the Tailscale app on the same account.** On iOS and Android that app holds the single VPN slot, which clashes with a proxy VPN app. | `measured` KB 1105; `docs/deploy/tailscale-mobile.md` "Known pitfalls" |
| A user with no Tailscale account | **Can sign up in the same page** (Google, Microsoft, GitHub, Apple, passkey). A Gmail, Apple or GitHub sign-up lands on the free Personal plan. A custom-domain sign-up gets a 14-day trial, after which new devices stay pending. | `measured` screenshot; pricing FAQ |

**Conclusion.** Embedded tsnet is the right primary path for cairn, but "one click" is not true. It is about 4-6 clicks once per server, plus the Tailscale app once per phone. The proposal needs three additions: an HTTPS consent step, key-expiry handling, and a no-Tailscale fallback. `inferred`

## 5. Recommendation: one path

**Tailnet-first, in the app: the sidecar ships in the desktop app and starts on first launch in a not-logged-in state; joining happens only after a button press. Tailnet owner identity (#3440) admits the owner's devices with no token. QR pairing stays for devices that cannot run Tailscale.** This is the HA Tailscale add-on flow with the manual console steps replaced by links surfaced in cairn, plus t3code's per-device pairing as the fallback.

### 5.1 Why not the alternatives

- **VS Code-tunnel style account sign-in (relay).** Best phone UX in the table, but it needs a cairn-run relay and identity service. D103 rules that out, and it would put every transcript through the relay, as Claude RC stores them (`measured` remote-control doc). Revisit only if the phone VPN clash (§4) proves common among users. `inferred`
- **Pairing as primary.** Pairing needs a route first (pattern 3). On a tailnet, owner identity already removes the pairing step, and off a tailnet pairing alone gives LAN-only plain HTTP, which breaks the iOS PWA and push (`measured` `docs/deploy/tailscale-mobile.md`: HTTPS required). It stays the fallback. `inferred`
- **System `tailscale serve` (t3code, the current server host).** Needs root or operator to serve a Unix socket (`measured` prior research §2), so it fails "no sudo". It stays as the advanced mode (`CAIRN_TSNET=socket`). `inferred`
- **Funnel as default.** It is public, has no identity, and D103 §4 keeps it opt-in. It is the route for a phone that cannot run Tailscale, gated by a pairing token. `inferred`

### 5.2 Numbers

| Step | Clicks | Typed | Commands | Mark |
|---|---|---|---|---|
| Server, first time: **Connect with Tailscale** in cairn, which opens `authUrl` in the default browser | 1 | 0 | 0 | `inferred` (the sidecar emits `authUrl`, `measured`) |
| Tailscale login page: pick the IdP, then the IdP account picker or consent | 1-2 (sign-up adds the IdP's own steps) | 0 if already signed in | 0 | `measured` page; IdP steps `unverified` |
| Confirm connecting the device on Tailscale's page | 1 | 0 | 0 | `unverified` (sign-in not completed this session) |
| HTTPS consent link from cairn, then Enable on Tailscale's page (only when HTTPS is off) | 2 | 0 | 0 | `inferred` from `QueryFeature`; KB 1312 |
| Optional: disable key expiry for the `cairn` node (cairn links to the admin Machines page) | 2 | 0 | 0 | `measured` KB 1028 steps |
| **Server total** | **4-6 (+2 optional)** | **0** | **0** | `inferred` |
| First phone without Tailscale: install the app, Get Started, allow VPN, sign in with the same IdP | about 5 taps plus the store install | 0 | 0 | `measured` KB 1020/1079 |
| Then scan the **Open on phone** QR in cairn, which opens `https://<node>.<tailnet>.ts.net/app` and is admitted as the owner | 1 scan | 0 | 0 | `inferred` (owner admit is `measured` in #3440 e2e) |
| Optional: Add to Home Screen for the PWA and push | 3 | 0 | 0 | `measured` deploy doc |
| **Each additional device already on the tailnet** (the owner's iPhone today) | **1 scan or 1 bookmark** | **0** | **0** | `inferred` |

[Redacted: private measurements.]

**No Tailscale account.** The Connect page lets the user sign up in place (`measured`). Users who decline get LAN QR pairing (HTTP, same Wi-Fi, no iOS push), or opt-in Funnel plus QR pairing for a phone without the Tailscale app. Remote access is otherwise absent; nothing else breaks. `inferred`

### 5.3 Security boundary

- The tailnet policy decides who can reach the node at all; the default policy allows all devices (`measured` KB 1018 via prior research). Inside that, cairn admits as owner only an untagged, non-sharee peer whose login equals the node's own login. That arrives on the 0600 socket, with the CSRF rule for ambient identity (`measured` deploy doc "Authentication boundary"). Unchanged by this proposal. `inferred`
- Trusted parties: the Tailscale control plane, which asserts who the user is (`inferred`: a control-plane compromise could forge identity); the user's IdP; and same-uid local processes (already trusted, `measured` prior research §4).
- New exposures: the node name goes into CT logs when HTTPS is enabled (`measured` KB 1153), and the node state dir holds the node key (`inferred`: keep `<CAIRN_HOME>/tsnet/state` at 0700, as `ensurePrivateDir` does, `measured`).
- Funnel stays off by default, token or pairing only, no identity, no screen (D103 §4).
- Starting the sidecar unauthenticated joins nothing: the node exists in the tailnet only after the user completes the login (`measured`: no `zca-walk` node after the scratch run).

### 5.4 Failure modes the implementation must cover (tests first)

| # | Failure | Required behaviour | Mark |
|---|---|---|---|
| Z1 | HTTPS off on the tailnet, so `ListenTLS` errors | Sidecar reports `needs-https` with the `QueryFeature` URL; UI shows an **Enable HTTPS** link; retry after consent. | `measured` error strings; flow `inferred` |
| Z2 | MagicDNS off (old tailnet) | Same, with the admin DNS link. | `measured` |
| Z3 | Node key expiring or expired | Report `keyExpiry` from `Self`; warn 14 days ahead; on expiry surface the new `authUrl`; offer the disable-expiry link. | `inferred` |
| Z4 | Device approval on | Report `needs-approval` and link the admin Machines page. | `measured` KB 1244, 1099 |
| Z5 | Hostname taken, so the node becomes `cairn-1` | UI and QR read the URL from `ready.dnsName`, never assume `cairn`. | `measured` KB 1098 |
| Z6 | Phone has a proxy VPN active (single VPN slot) | Remote access page explains it and offers Funnel plus pairing. | `measured` KB 1105 |
| Z7 | Custom-domain tailnet whose trial lapsed | The node stays pending; show Tailscale's message as is. | `measured` pricing FAQ |
| Z8 | Logged in as a different Tailscale user than the phone | Phone gets 401 and the token gate; UI shows "signed in as X" on the server side. | `inferred` from the owner rule |
| Z9 | Sidecar crash, or stdin closes | Already covered by F10; stdin EOF stops the sidecar (`measured`), so the server must keep the pipe open. | `measured` |

### 5.5 Code areas

- `apps/tsnet-sidecar/internal/sidecar/{node.go,run.go,protocol.go}`: on a `ListenTLS` error, call `LocalClient().QueryFeature("serve")` and emit `needs-https{url}`; add `keyExpiry` and `needsApproval` to the status message.
- `apps/server/src/services/tsnet-remote.ts`, `apps/server/src/lib/tsnet-sidecar.ts`: state machine `off | needs-login | needs-approval | needs-https | running | expiring`. Start the sidecar from a **persisted setting** written by the Connect button instead of only `CAIRN_TSNET` (`apps/server/src/config.ts:206`). The spec 30 rule "no `flag()` gating, off until the user acts" applies.
- `apps/server/src/routes-remote.ts` plus `packages/shared/src/remote-access.ts`: `POST /api/remote/tailnet/connect` (owner only), plus the new states in `/api/remote/routes`.
- `apps/web/src/routes/remote-access-page.tsx`: a **Connect with Tailscale** button instead of the text URL; the HTTPS and expiry links; an **Open on phone** QR of the `ts.net` URL; Funnel stays an explicit opt-in.
- `apps/desktop` (planned): ship `tsnet-sidecar-<os>-<arch>` in `extraResources` and open `authUrl` with `shell.openExternal` (matches [desktop-app-stack](desktop-app-stack-2026-11-08.md) step 5). The npm route needs per-platform optional packages (D103 S6, lockfile change needs the owner).
- Not touched: `apps/server/src/lib/token-auth.ts` (credentials surface). Owner admit already exists from #3440, so this change adds no new auth rule. `inferred`
- `docs/deploy/tailscale-mobile.md`: the in-app flow becomes the main path; socket mode moves to an "existing tailscaled" section.

## 6. Open items

- The post-login "connect device" page and the HTTPS consent page were not walked: they need the owner's sign-in. Walk them once with a throwaway hostname, then remove the node. `unverified` until then.
- Whether `QueryFeature("serve")` returns a URL on a tsnet node (rather than only on tailscaled) needs a sidecar spike. `inferred`
- Windows: Unix-socket upstreams for the sidecar are unverified (desktop-app-stack §open items). `unverified`

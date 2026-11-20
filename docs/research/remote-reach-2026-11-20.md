# Remote reach: IM channels and a personal relay — research

Date: 2026-11-20. Purpose: decide how the owner reaches his Cairn away from the Mac — phase 1 IM channels (Telegram, iMessage, Slack, WeChat), phase 2 a cloud relay for a second computer. Companion plan: [docs/design/remote-reach.md](../design/remote-reach.md).

Marks: **verified** = read the code or the primary doc first-hand this round; **inferred** = derived from verified material; **unverified** = community lore or vendor claim I did not independently confirm.

## 1. What exists in Cairn today (verified, code-read)

`apps/server/src/services/im/` is a working IM surface, not a stub:

- **Core** (`im/core.ts`): pairing gate (unpaired senders file a request, owner approves in Settings > IM), inbound dedupe (`imSeenInbound`), per-chat serial send queue on the `im-send` effect ledger (4 attempts, backoff, honors `retry_after`), origin-scoped replies — a reply leaves only to the connection/chat that started the turn, and only while every owner of that turn is an IM message (`turnIsImOnly`). Inbound goes to `enqueueChiefStep` on the Coordinator thread with `provenance=im:<platform>:<conn>:<chat>`; `turnFinished`/`notice` send the last assistant text back.
- **Telegram** (`im/telegram.ts`): bot token checked via `getMe`; inbound = `getUpdates` long poll (50 s, `allowed_updates: ['message']`); group chats only when the bot is @-mentioned; outbound chunked at 4096 chars, `parse_mode: Markdown` with plain-text fallback, `inline_keyboard` buttons supported, `reply_parameters` threading.
- **Slack** (`im/slack.ts`): `xapp-` + `xoxb-` tokens, Socket Mode via `apps.connections.open`; inbound = DMs only (`channel_type === 'im'`, no subtype); every envelope ACKed; outbound `chat.postMessage` with Block Kit `actions` buttons, thread replies.
- **WeChat** (`im/wechat.ts`): Tencent iLink bot (`ilinkai.weixin.qq.com`) — QR login issues a bot token bound to the scanning account, then `getupdates` long poll + `sendmessage`; ~1800-char chunks, text only; `SESSION_EXPIRED` → re-scan. Protocol is unpublished (community port via MIT `dsh-im`); Tencent can cut it any time.
- **Settings > IM** (`apps/web/src/routes/im-page.tsx`): three connector cards, status chips, pairing approve/reject, WeChat QR dialog.
- **Not yet**: no iMessage adapter (`IM_PLATFORMS = ['telegram','wechat','slack']`); no inbound button path (Telegram polls only `message` updates — no `callback_query`; Slack handles only `events_api` frames, not `interactive`); outbound `buttons` exists in `ImOutboundMessage` but the `im-send` payload drops it (`imSendPayload` keeps only `chatKey`/`text`/`replyToMessageId`); attachments not ingested (`images: []` everywhere).

**Remote access (verified)**: the tsnet lane already landed — `apps/tsnet-sidecar` (Go, tsnet v1.104.5), supervised by `services/tsnet-remote.ts` (off by default), serving the app on a private tailnet unix socket with owner-login identity checks and `allowedLogins`; `services/tailscale-serve.ts` covers the system-tailscaled path. The Remote Access page issues 5-minute one-use pairing QR/links over LAN and tailnet origins; pairing yields a device session in the existing paired-devices machinery. Machine↔server traffic is outbound-only HTTP + SSE (`apps/daemon/src/machine-client.ts`: `POST /api/machine/tasks/claim`, heartbeat, `/api/machine/stream` SSE under a machine bearer) — the shape an off-box iMessage bridge reuses.

**Prior relay work (verified)**: `docs/design/connect-do-prototype.md` (a Cloudflare Durable Objects relay transport experiment, built and run locally in Miniflare), `docs/design/connect-do-enrollment.md` (install/pairing/budget design), and `docs/design/retire-connect-relay.md` — #5341 removed the unmounted relay code on 2026-11-15, paused "in favor of Tailscale mode". `docs/design/cairn-connect.md` is a separate, unimplemented Cloudflare Tunnel proposal. The DO relay's wire grammar and failure contract are reusable design assets; nothing of it is deployed.

## 2. Per-channel findings

| Channel | Inbound transport | Needs public URL? | Rich replies / buttons | Attachments | Setup the user does |
|---|---|---|---|---|---|
| Telegram | `getUpdates` long poll (current) or `setWebhook` | No (polling). Webhook needs a public HTTPS URL | Markdown/HTML, inline keyboards + `callback_query` (inbound not wired yet) | `getFile`→download photos/docs; send* media methods | Create bot in @BotFather, paste token (verified: adapter + api docs) |
| Slack | Socket Mode WebSocket (current) or Events API to a public endpoint | No (socket). Events API needs public URL | mrkdwn + Block Kit `actions`; interactive payloads arrive on the same socket (verified: Slack Events API page offers exactly the two transports) | `files.info`/upload APIs | Create Slack app, enable Socket Mode, mint `xapp-` + `xoxb-` (verified: adapter + docs) |
| WeChat (iLink) | `getupdates` long poll | No | Text only → numbered replies convention | image items exist inbound; no documented send-image in our adapter | Scan QR in WeChat (verified: adapter) |
| iMessage | Mac-local: `chat.db` + AppleScript / `imsg` stdio | No — everything stays on the Mac | Text, tapbacks/effects only with SIP-off private API; no real buttons → numbered replies | chat.db attachment blobs; `imsg` send/attach | Grant Full Disk Access + Automation→Messages to the bridge process (verified: imsg README, OpenClaw docs) |

## 3. iMessage options

There is **no official personal iMessage API**. Every option either automates a local Messages.app or rents someone else's fleet.

| Option | How it works | Cost | Must stay running | Identity / UK number | ToS / ban risk |
|---|---|---|---|---|---|
| **`imsg` CLI** (`openclaw/imsg`, MIT, verified README) | Reads `~/Library/Messages/chat.db` (Full Disk Access), watches it for new messages (NDJSON/JSON-RPC stdio), sends via Messages.app AppleScript (Automation permission). SIP-off helper adds tapbacks/typing/effects | $0 | The Mac, awake, signed into Messages; the Cairn process needs FDA + Automation grants | Uses whatever Apple ID is signed in — an **iCloud email identity works fine**; no phone number needed. A dedicated Apple ID (email) isolates the bot | Unofficial but widely used; AppleScript send is a supported macOS surface. Volume should stay personal-scale (inferred) |
| **BlueBubbles server** (verified docs) | TypeScript macOS app: AppleScript sends + polls chat.db; REST + WebSocket API; Private API bundle (SIP off) for reactions. Needs Full Disk Access; their client apps need Firebase; reachability via built-in proxy service | $0 OSS | Same Mac requirements, plus the server app (now **unsigned** — Apple revoked their dev account, verified manual-setup doc) | Defaults to iCloud-email identity; registering a phone number needs SIM-swap tricks or a spare/jailbroken iPhone (verified registering doc) | Same class as imsg. Note: OpenClaw **removed** BlueBubbles support in favor of `imsg` (verified OpenClaw iMessage doc) |
| **Apple Messages for Business** (verified register.apple.com) | Official B2C channel — consumer initiates via entry points; business replies through an **Apple-approved MSP** | MSP fees (enterprise); Apple Business Register + corporate email + screen-recorded Experience Review | MSP infrastructure | Brand identity, not personal | Official, but a personal bot cannot qualify — rejected |
| **Sendblue** (verified pricing) | iMessage API on their dedicated phone lines; webhooks for inbound | Sandbox free (shared number, 10 contacts); **$100/mo per dedicated line**, inbound-first; Enterprise custom | Their Mac farm | They provision/port a number (port-in 3–5 days); UK number not needed — owner texts their line first | Vendor manages Apple-side risk; per-line daily contact caps |
| **Linq** (verified pricing) | Same category — iMessage/WhatsApp/SMS/RCS API; Poke (Cognition) is a customer | Hobby **$0** (20 contacts, full API, webhooks); Business **$260/mo** dedicated line | Their infra | Dedicated line on Business | Same |

**Recommendation**: `imsg` as the iMessage mechanism — matches the DS-Bot rule "no public callback address", costs nothing, and OpenClaw runs the identical integration in production (spawn `imsg rpc`, speak JSON-RPC over stdio). Per owner decision (2026-11-20) the bridge lives on a **separate always-on Mac mini** — Messages signed into his own Apple ID with the UK number — beside a Cairn Runner, so the adapter contract needs one network hop: a thin bridge process on the mini that dials out to the server (the same outbound-only shape as `machine-client`), keeping pairing/dedupe/send-queue state server-side. OpenClaw's documented alternatives for exactly this topology: `cliPath` = SSH wrapper running `imsg` on the remote Mac (zero-code interim), or a dedicated bot macOS user for a separate iMessage identity. BlueBubbles is the fallback if a REST/WebSocket surface is preferred over a subprocess; its Firebase/proxy/unsigned-app baggage makes it second choice. Paid APIs only if ian wants a separate phone number identity without touching his Apple ID.

What must stay running for any local-bridge option: the Mac, awake, signed into Messages, with the bridge process alive — the same keep-awake requirement every remote-access story has (Codex and Cursor both ship explicit keep-awake toggles for this reason, verified Codex remote-connections doc).

Ban/ToS: Apple has no sanctioned personal-bot path; both bridges ride on the signed-in Apple ID. **Unverified/community**: reports of Apple IDs flagged for automated volume exist; the mitigation is a dedicated Apple ID (email identity) on a dedicated macOS user — OpenClaw documents exactly this "dedicated bot macOS user" pattern (verified).

## 4. Relay options

| Option | Shape | Cost | Trust | Notes |
|---|---|---|---|---|
| **tsnet (already shipped)** | Tailnet socket; devices join owner's tailnet | $0 | Tailscale coord + E2E WireGuard | Solves "two computers" today whenever both can run a Tailscale client or the host exposes the tailnet socket (verified repo) |
| **Cloudflare Durable Objects** | Worker + one SQLite DO; host + clients open outbound WSS | Free plan sufficient at personal scale: 100k req/day, 13k GB-s/day; incoming WS messages billed 20:1 as requests; **hibernating sockets incur no duration billing** (verified DO pricing) | Cloudflare + account owner see everything unless E2E added | Retired Cairn design covers wire grammar, pairing, budgets; needs a Wrangler install wizard per user — the enrollment doc's heaviest cost |
| **Self-hosted VPS relay** | One binary behind Caddy TLS; same outbound-WSS shape | VPS ~$4–6/mo (inferred; Hetzner/DO entry tiers) | The owner's own box — the cleanest trust story short of E2E | Happy proves the shape: `happy-server` is ~12k LOC TS, Docker w/ embedded PGlite, self-hosted via `HAPPY_SERVER_URL` (verified self-hosting doc) |
| **E2E option (Happy model)** | Relay forwards ciphertext only | Same infra | Relay sees nothing — master secret never leaves devices; QR pairing shares the content pubkey with the CLI (verified Happy security doc) | The correct end-state if the relay ever carries for strangers' traffic; adds key-management complexity on every client |

How the references do it (verified report.md + official docs): Claude Remote Control and Codex Remote Connections both relay through the vendor's account infrastructure — QR/short-code pairing, host keep-awake, outbound-only. Happy does the same shape self-hosted + E2E. No one ships inbound ports.

**Recommendation**: phase 2 ships one outbound-WSS relay protocol (reuse the retired DO experiment's exact envelope grammar — it was reviewed). First runtime: a single self-hostable binary on the owner's VPS (one afternoon of ops, cleanest trust). Managed DO deploy second, and only for users without a server — the retired enrollment design already prices that complexity. E2E per Happy's model is the upgrade path when a relay operator isn't the owner. Be explicit: for two Tailscale-capable computers, tsnet already solves this at $0 — the relay pays only for machines that can't join the tailnet or browser-anywhere reach.

## 5. Sources

- Repo: `apps/server/src/services/im/*`, `apps/server/src/routes-im.ts`, `apps/server/src/services/{tsnet-remote,tailscale-serve}.ts`, `apps/web/src/routes/{im-page,remote-access-page}.tsx`, `docs/design/{im-connections,cairn-connect,connect-do-prototype,connect-do-enrollment,retire-connect-relay}.md`, `/tmp/dogfood/personal-agents/report.md`
- imsg: `github.com/openclaw/imsg` README (verified); OpenClaw iMessage channel docs `docs.openclaw.ai/channels/imessage` (verified)
- BlueBubbles: `docs.bluebubbles.app` server readme / manual-setup / private-api / registering-a-phone-number (verified)
- Apple Messages for Business: `register.apple.com/resources/messages/messaging-documentation` (verified)
- Sendblue `sendblue.co/pricing`, Linq `linqapp.com/pricing` (verified)
- Cloudflare DO pricing `developers.cloudflare.com/durable-objects/platform/pricing/` (verified)
- Happy `happy.engineering/docs/guides/self-hosting` + `/docs/security` (verified)
- Codex `learn.chatgpt.com/docs/remote-connections` (verified)
- Slack `api.slack.com/apis/events-api` + socket-mode docs (verified); Telegram `core.telegram.org/bots/api` (adapter-verified behavior; webhook requirements are api-doc standard)
- WeCom group-bot webhook `developer.work.weixin.qq.com/document/path/91770` (verified push-only); WeCom requires a verified enterprise entity (inferred)

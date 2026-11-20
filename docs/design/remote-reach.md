# Remote reach: IM entries and a personal relay

Status: plan. [Research](../research/remote-reach-2026-11-20.md) records every claim and its verification mark. Builds on [im-connections](im-connections.md) (landed), the landed tsnet remote access, and the retired [connect-do](connect-do-prototype.md) relay designs. Owner decisions this round: no phone app; phase 1 = IM channels; phase 2 = a relay for computers, Cloudflare Durable Objects or self-hosted VPS; the iMessage bridge runs on a separate always-on Mac mini (Messages signed into his Apple ID with the UK number) that also hosts a Cairn Runner, and the phase-1 check happens there. The in-app remote-access switch (tsnet) is another lane's — referenced, not redesigned.

## The newcomer

Someone who installed Cairn today meets this in two settings surfaces. **Settings > IM**: three working connectors — Telegram (paste a BotFather token, free, 2 minutes), Slack (paste `xapp-` + `xoxb-` from a Socket-Mode Slack app, free), WeChat (scan a QR with the app already on their phone). iMessage, when it ships, asks for no account at all — just an always-on Mac with Messages signed in (for the owner: a Mac mini that also runs a Cairn Runner) and macOS permission grants for the bridge process there. **Remote Access**: a 5-minute one-use QR pairs a browser on LAN or the owner's tailnet; a paid relay, when offered, is an opt-in for machines that can't join the tailnet. All channel credentials live in Cairn's local secret box; message content transits the IM vendor's servers or, later, the chosen relay — never Cairn-operated infrastructure. Failure surfaces as a status chip on the connection card (expired WeChat → re-scan; dead bot token → error reason), never as silent loss: unpaired senders are told they await owner approval, and replies only ever return to the chat that asked.

## Why

The owner needs to reach the Coordinator away from his Mac — steer work, answer approvals, get notified — without a phone app. Two transport families cover it without Cairn running any public infrastructure: chat platforms as the carrier (phase 1), and an outbound-websocket relay for computers/browsers that can't use the tailnet (phase 2).

## What already works today (code-verified)

- Telegram adapter: long-poll inbound (DMs + @-mentions in groups), chunked Markdown replies with plain-text fallback, inline-keyboard support outbound.
- Slack adapter: Socket-Mode inbound (DMs only), Block Kit buttons outbound.
- WeChat adapter: Tencent iLink QR login + long poll, text-only with numbered-reply convention, re-scan on expiry.
- Shared core: pairing allow-list, origin-scoped replies, serial send queue with retry, inbound dedupe.
- Remote Access: LAN + tailnet origins, QR pairing → device session; tsnet sidecar shipped but off by default.
- Gaps: no inbound button path anywhere (`callback_query`/`interactive` frames unhandled; the effect payload drops `buttons`), no attachment ingestion, no iMessage.

## Phase plan — each phase ends in a check the owner runs himself

| # | Slice | End-to-end check |
|---|---|---|
| 1a | Dogfood what's shipped | Owner creates a Telegram bot, connects it in Settings > IM, approves his own pairing request, sends a message from his phone — a Coordinator thread picks it up and the reply lands in Telegram. WeChat/Slack same flow on demand. |
| 1b | iMessage bridge (`imsg`) on the always-on Mac mini | From his phone, owner iMessages his own Apple ID; it lands in the mini's Messages, the bridge forwards it to the Coordinator, and the answer arrives back in Messages — sent as his own Apple ID, so the "text yourself" conversation is the channel. No public URL, no third party; the mini must stay awake and signed in. |
| 1c | Depth slice: buttons in, attachments in | An approval card arrives in Telegram with real buttons; owner taps Approve on his phone and the step unblocks. Owner sends a photo; the Coordinator sees the image. Same inbound path covers Slack `interactive` frames. |
| 2a | Self-hosted relay binary on the owner's VPS | Second computer on a phone hotspot (tailnet off) opens the relay URL, pairs by QR, creates a task, sees it stream. Host and client both dial out; TLS + capability auth; E2E per Happy's model is the documented upgrade when the operator isn't the owner. |
| 2b | Managed Cloudflare DO deploy (optional, for users without a server) | Same check as 2a against a `workers.dev` origin installed by the wizard from the retired [enrollment design](connect-do-enrollment.md). Free-plan SQLite DO + WebSocket hibernation keeps a personal relay at ~$0. |

Recommended order: 1a first (zero code), then 1b — iMessage is the owner's daily-driver chat and the only channel with no third-party account at all — then 1c, then 2a. 2b only when a non-owner user needs it.

## Decisions

- **iMessage = `imsg` behind a thin bridge on the always-on Mac mini**, beside the Cairn Runner. The bridge spawns `imsg rpc` (Full Disk Access + Automation grants on the mini), and dials out to the Cairn server over the same outbound-only pattern the machine client already uses — no inbound port on the mini, works identically over LAN, tailnet, or the phase-2 relay. Server side, the bridge's session maps onto the existing `ImAdapter` contract, so pairing, dedupe, send queues and origin-scoped replies are unchanged. OpenClaw runs the same `imsg rpc` integration in production and documents the SSH-shim variant ("remote Mac over SSH") as the zero-code interim for a gateway off-box. Identity = the owner's own Apple ID with his UK number (his call — bot traffic rides his real account; a dedicated Apple ID on a dedicated macOS user stays the documented hardening). Rejected: BlueBubbles (heavier: Firebase, proxy service, now-unsigned app; OpenClaw itself dropped it for `imsg`), Apple Messages for Business (needs an approved MSP + corporate registration + Apple review), paid APIs (Sendblue $100/mo/line, Linq $0–260/mo) — kept as the escape hatch for a separate phone-number identity.
- **Relay = one outbound-WSS protocol** using the retired DO experiment's reviewed envelope grammar, shipped first as a single self-hostable binary behind Caddy (owner's VPS, ~$5/mo, cleanest trust short of E2E). The managed DO variant reuses the retired enrollment design verbatim when a VPS-less user appears. Explicitly not for: IM channels (all outbound already) and tailnet-capable computers (tsnet already covers them at $0).

## Scenario table

| Situation | What the user sees | What the system does | Wait / cost |
|---|---|---|---|
| Owner on his phone, Telegram open | Chat with his bot; pairing gate first | Long-poll wakes the Coordinator; reply returns to the same chat only | Seconds; free |
| Owner on iMessage | Conversation with his own Apple ID | `imsg` bridge on the awake Mac mini (also his always-on Runner) forwards to the Coordinator | Seconds; free; mini must stay awake and signed in |
| Unpaired contact messages a connector | "Awaiting owner approval" | Pairing request queued for Settings > IM; nothing reaches the Coordinator | — |
| Approval needed while away | Card with buttons (Telegram/Slack) or numbered text (WeChat/iMessage) | Inbound answer resolves the existing question/approval — no second approval system | Seconds |
| Second computer, no Tailscale | Relay URL + pairing QR | Both ends dial out to the owner's relay; existing device-session auth on top | Seconds; ~$5/mo VPS or ~$0 DO free tier |
| Host asleep / WeChat expired | Status chip: unreachable / expired | Senders see failure honestly; WeChat offers re-scan | — |

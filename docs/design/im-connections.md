# IM connections: Telegram and WeChat as entries

Status: first slice landed 2026-11-17 (pair → receive → text reply, Telegram + WeChat iLink; decision-card buttons are the next slice). Slack slice landed 2026-11-18 (Socket Mode adapter, DM-only inbound, Block Kit buttons outbound). Owner decisions recorded 2026-11-17: first adapters are **Telegram and personal WeChat (Tencent iLink)**; IM is the future "C class" entry pulled forward (spec 18 §3.5/§4); monetization deferred — users first, no paid surfaces.

Unblocked by: #1607 (`docs/research/1607-acp-execution-surface.md`) concluded — ACP covers external-agent onboarding, so the IM entry is free to be designed on its own.

## 1. What IM buys

The phone reaches the Coordinator without a native app and without Tailscale: decision cards and notifications land in a chat app the owner already lives in, and replies steer the thread. The IM platform supplies delivery and push — cairn runs zero public infrastructure, unlike a hosted relay (which would need a spec 18 §4 amendment).

Prior art walked: DS-Bot (8 adapters as its entire mobile story, no native mobile app) — `docs/research/ds-bot-vs-cairn-2026-11-17.md` §1, §5. It has no public web access at all: away from the machine, IM is the only reach. This note adopts its adapter architecture and rejects its breadth.

## 2. Platform pick

| Platform | API | Registration | Transport | Interactive replies | Notes |
|---|---|---|---|---|---|
| **Telegram** | Bot API | bot token from BotFather, no approval | long poll, outbound only | inline keyboards (buttons) | mainstream for personal bots; reaching it is the user's own network concern |
| **WeChat (iLink)** | Tencent iLink (`ilinkai.weixin.qq.com`) | QR scan in WeChat binds a Tencent-side bot to the scanning account; no developer registration | long poll, outbound only | **none — text only; numbered replies** | owner-accepted risk: the endpoint is Tencent's own but the protocol is unpublished (community port via MIT `dsh-im`, clients identify as a reference client version); ~1,800-char chunks; replies only within a window after the user's message; session can expire → re-scan; Tencent can cut it any time |
| **Slack** | Web API + Socket Mode | user creates a Slack app: app-level token (`xapp-`, `connections:write`) + bot token (`xoxb-`) | outbound WebSocket | Block Kit `actions` buttons | DM-only inbound (`channel_type === "im"`, no `subtype`); every envelope is ACKed; `disconnect` envelopes and socket drops re-open via `apps.connections.open` |

Not now: **Feishu** (open.feishu.cn self-built app, WebSocket long conn, richest cards — kept as the documented fallback if iLink dies, and the China-reachable option for users who will not accept iLink's risk); Discord (same outbound-only shape, add by user demand); WeCom and DingTalk (corporate-entity registration); QQ (approval + guild scope + reply window); ntfy/Matrix/Gotify (open but thin two-way — revisit only if a push-only interim is wanted).

## 3. Rules taken from DS-Bot (source-read 2026-11-17)

1. **Outbound only.** No platform that requires a public callback address: cairn lives behind NAT, and requiring port forwarding or a tunnel would fail the second-person criterion. Both picks natively poll/connect out.
2. **Two layers.** One adapter per platform (`check(fields)` → `connect(fields, handlers)` returning `{send, edit, typing, stop}`), one core owning pairing, routing, cards and send queues. `env` injects `fetch`/`WebSocket` so tests fake the network.
3. **One inbound shape.** `{chat:{key,kind,title}, sender:{id,name}, text, images, files, mentioned, messageId}`; group messages count only when the bot is mentioned.
4. **Pairing allow-list.** An unpaired sender is recorded as a request and gets one "requested" reply; the owner approves in settings; button presses from unpaired users are ignored.
5. **Origin-scoped replies.** A reply leaves only for the connection/chat/sender that started the turn. A turn mixed with other sources goes to a `mixed` set and can never go to IM again. After a restart there is no origin, so nothing is sent. This is the rule that keeps contexts from leaking through IM.
6. **Serial send queue per chat.** Failures classed permanent / drop / retry (4 attempts, 5 s doubling to 30 s, honoring `retry_after`); failed messages keep a "try again" action; text chunked per platform limit; markup the platform rejects is resent as plain text.
7. **No secret fill from chat** — a filled value would sit on the platform's server. Secrets live in the existing store as per-connection host secrets, scrubbed from error text.
8. **Numbered replies where there are no buttons** — primary for WeChat (a digits-only message answers the newest open question/approval card when it clearly fits); Telegram uses real buttons, with the same rule as fallback.

## 4. Where it lands in cairn

- New `apps/server/src/services/im/` — a core plus `telegram.ts` and `wechat.ts` adapters, beside `services/push.ts`; it is a transport surface, not a second inbox and not a second approval system (spec 18 §1: one loop, one approval mechanism).
- Inbound → Coordinator wake carrying `provenance=im:<platform>:<conn>:<chat>` (same shape as `docs/design/mail-connector.md`'s provenance tag). Outbound → existing decision/approval cards rendered as platform buttons (Telegram) or numbered text (WeChat).
- Credentials → existing secret store; only the server holds the connection (DS-Bot's team-lock equivalent is trivial here: one server per cairn home).
- New state: `im_connections` (platform, secret ref, paired senders, status). Origins live in memory only (decided §7).
- Threads: an IM turn attaches to the thread its origin opened; a bare IM message can also open a new thread, same as any Coordinator message (decided §7).

## 5. Failure modes to cover at build time

| # | Mode | Handling |
|---|---|---|
| F1 | Token/app credential refused | Permanent; reason shown in settings; no retry loop |
| F2 | Another process owns the bot (Telegram 409) | Permanent error shown; do not flap |
| F3 | Restart | Origins empty → nothing sent; connections resume polling |
| F4 | Platform rate limit / reply-window expiry | Retry honors `retry_after`; window-expired sends surface as undeliverable on the card |
| F5 | Secret-shaped inbound text | Treated as data; never filled back (mail-connector caliber) |
| F6 | iLink session expired (`SESSION_EXPIRED` on getupdates) | Connection shows re-scan state; a fresh QR is offered in settings; no silent re-login |

## 6. Not doing in the first adapters

Group-chat routing beyond @-mentions, voice/image ingestion (Telegram voice transcripts are free — optional follow-up), creating threads from group chats, any Feishu/Discord/QQ/WeCom/DingTalk adapter, any platform needing a public webhook. Slack interactive button presses are ACKed but not routed until core gains an inbound button path (same stage as Telegram).

## 7. Open questions before build — decided 2026-11-17

- Origins: memory-only, matching DS-Bot's restart semantics (nothing sent without a live origin).
- IM-originated messages can open new threads, same as any Coordinator message.
- Build order: **Telegram first** — an official API with buttons validates the core (pairing, inbound shape, send queue, provenance) cheaply; WeChat's quirks (numbered replies, reply window, re-scan) then slot into a proven core.
- First slice: pair → receive → reply as text. Decision cards as Telegram buttons land in the second slice, once the card→button mapping is designed.

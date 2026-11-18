# DS-Bot against cairn: what differs and what cairn can borrow (2026-11-17)

Labels: **verified** = read first-hand this round (file text through `gh api`, cairn files in this checkout at `98fc6e0ec`). **inferred** = follows from verified facts. **speculative** = the rest. DS-Bot was read at the default branch on 2026-11-17 (pushed 2026-11-17T05:14Z, 8,132 stars, Apache-2.0). Source: https://github.com/Fei2411/DS-Bot

Scope limits: I read DS-Bot's README, AGENTS.md, SECURITY_MODEL.md, `docs/vision.md`, seven design notes under `docs/plans/`, `browser-plugins/`, and the file tree. I did not read its host code (`ds-bot/src/host/`) and did not install or operate the app, so behavior claims rest on its design notes, not on running it. `~/.claude/skills/research/SOURCES.md` does not exist, so no designated source rows applied; sources were chosen by the question. This was done inline, not by a background agent.

## 0. Answer in five lines

1. They are different products. DS-Bot is a persistent **team of role-playing Bots** you chat with in rooms; cairn is a **dispatcher** that turns a request into isolated task threads and gates what lands. (verified: DS-Bot `docs/vision.md`; cairn `docs/spec/18` §1)
2. DS-Bot is built on a third-party harness (DeepSeek Harness) and never patches it; cairn owns its server, daemon and runtime. (verified: DS-Bot AGENTS.md rule 1)
3. DS-Bot is ahead on reach: Windows/macOS/Linux installers, eight IM platforms, a per-bot browser with cookie import, computer-use levels, Office files. cairn's desktop builds only a Mac target. (verified: DS-Bot README; cairn `apps/desktop/electron-builder.yml` has only `mac:`)
4. cairn is ahead on trust: patch-bound merge gate, an eval ruler agents cannot edit, per-task isolation, TLA+ models. DS-Bot has none of these; its safety is permission presets, redaction and approval cards. (verified: both security docs)
5. The worth-borrowing items are narrow: relevance-based memory recall, the IM provenance rules, a held-out "effect" test for learned skills, and a Windows build. Detail in §3.

## 1. Comparison

| Axis | DS-Bot | cairn | Trade-off |
|---|---|---|---|
| Thesis | "A team of long-lived bots"; main bot (Chief) manages other bots and group chats ([vision](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/vision.md)) | "Self-hosted personal assistant for people who write code"; one Coordinator opens a thread per piece of work (`docs/spec/18` §1) | DS-Bot's unit is a bot identity; cairn's is a task |
| Unit of work | A bot's chat session; group chat rounds with an admin; `group_task` board per group ([plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-11-12-group-task-board.md)) | Todo → build → one worktree and branch (`CONTEXT.md`) | cairn work ends in a landed artifact; DS-Bot work ends in a reply |
| Multi-agent | Bots message each other, @ handoffs, Goals split into stages ([README](https://github.com/Fei2411/DS-Bot/blob/HEAD/README.md)) | Coordinator dispatches workers; no bot-to-bot chat (inferred: none in `CONTEXT.md` or spec 18) | DS-Bot costs more tokens in groups, which its README admits |
| Runtime | DeepSeek Harness sessions; local CLIs (Claude Code, Codex, Cursor, others) can be attached as bots | pi runtime plus Claude Code/Codex harnesses on runners | cairn controls its runtime; DS-Bot inherits DSH limits and keeps a concessions ledger ([plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-10-13-dsh-concessions.md)) |
| Landing and review | None described; "check important actions yourself" ([README disclaimer](https://github.com/Fei2411/DS-Bot/blob/HEAD/README.md)) | Evidence-bound merge gate, AI review with teeth, TLA+ models (`docs/spec/18` §1.1) | Core differentiator for cairn |
| Isolation | Permission preset per bot; Docker is the boundary in the Docker edition ([SECURITY_MODEL](https://github.com/Fei2411/DS-Bot/blob/HEAD/SECURITY_MODEL.md)) | Orb container per task (opt-in), worktree per build | cairn stronger; DS-Bot states plainly that private bots are not an OS sandbox |
| Memory | Four read modes: frozen per segment, incremental deltas, BM25 auto-recall, on-demand `recall`; entries carry `until`/`pinned`; daily tidy with an undoable `retired.jsonl` ([plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-11-09-memory-layers.md)) | Row-backed; 3,000-token capped injection of recent core facts; tools to save/update; tidy pass retired (`docs/design/memory-backend.md`) | DS-Bot recalls by relevance; cairn by recency. cairn chose to retire the tidy pass |
| Chat state | Append-only ledger per group, every view reads from it ([plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-11-10-message-ledger.md)) | Chief outbox persistence design (`docs/design/chief-outbox-persistence.md`) | Same bug class (several copies of one message drifting); not compared further |
| Browser | One Chromium profile per bot, cookie import, handoff card for login/captcha/payment, post/upload/download/delete need approval ([plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-10-21-browser-plugins.md)) | Browser login handoff and secret fill designs (`docs/design/computer-login-handoff.md`, `browser-secret-fill.md`) | Near parity by design; not verified by running either |
| Computer use | Levels view-only/background/foreground per bot, allowed apps, top bar to pause | `machine-computer.ts`; background-first model (`docs/research/user-computer-model-2026-11-08.md`) | Near parity by design |
| Entry points | Desktop app, DSH plugin, Docker; IM on WeChat, Feishu, DingTalk, WeCom, QQ, Telegram, Discord, Slack ([IM plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-11-04-im.md)) | Web app, Mac desktop, iOS, push; IM is a "possible future C class" (`docs/spec/18` §4) | DS-Bot meets users where they chat; cairn chose breadth later |
| Platforms | Windows, macOS, Linux installers (README) | Mac only desktop (`electron-builder.yml`) | Gap against the second-person criterion |
| Secrets | `secrets.json` 600, per-bot scope, redaction, optional scrypt + AES-GCM at rest ([plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-11-12-encrypted-secrets.md)) | `secret-box.ts`, per-step issue, audit row on retrieval (`CONTEXT.md`) | Both reasonable; cairn's audit row is the stronger idea |
| Self-improvement | `learning-eval`: does a created skill improve held-out tasks, does an unrelated task stay clean ([script](https://github.com/Fei2411/DS-Bot/blob/HEAD/ds-bot/dev/learning-eval.mjs)) | Eval-gated harness changes, trajectory export (`docs/spec/29`) | cairn has the bigger apparatus; DS-Bot has one useful test shape |
| Doc discipline | Plans with "decided / not doing / known limits"; threat model doc with maintainer-ranked assets and attacker profiles | Specs, ADRs, research notes; `SECURITY.md` asks for the attacker model but cairn has no ranked threat-model file (verified: `docs/security/` holds two files) | DS-Bot's one-page threat model is a cheap win |

## 2. Where DS-Bot's design is stronger on a point cairn also has

- **Provenance-scoped replies.** An IM reply goes only to the connection that started the turn; a turn mixed with other sources stops going to IM and cannot be reclaimed; secret cards are never filled from chat because the value would sit on the platform's server; unpaired accounts reach no bot ([IM plan](https://github.com/Fei2411/DS-Bot/blob/HEAD/docs/plans/2026-11-04-im.md)). cairn's mail connector design already treats inbound text as data (`docs/design/mail-connector.md`), but the outbound-channel rule is not written for cairn yet (inferred).
- **Memory by relevance.** Frozen common block per segment so the prompt stays byte-identical, deltas appended at the end, a few topic-relevant entries recalled on the first step of a turn. This protects prompt caching and still surfaces old facts (plan above). cairn's cap prefers recently updated rows and tells the model how many were left out (`docs/design/memory-backend.md`), so an old but relevant fact stays hidden unless the model searches (inferred).
- **Memory entries with expiry and pin**, and consolidation that is only a soft archive with batch undo. cairn removed its tidy pass on purpose; I would not reverse that, but `until` and `pinned` on rows are cheap (speculative: cairn rows have `invalidAt` but no user pin; not checked in code).

## 3. Recommendations for cairn

Ordered by value. Each names the code area. None is started.

1. **Relevance recall on the first step of a Coordinator turn.** Rank eligible memory rows by BM25 against the user's message, inject at most a few beyond the recency set, skip if none hit, no repeats in a segment. Touches `apps/server/src/services/memory.ts`, the Coordinator prompt builder. Keep the existing 3,000-token cap. Prior art: DS-Bot memory-layers plan; Letta core/archival split is already in `docs/research/personal-agent-memory-2026-11-07.md`. Per project rules this needs a short design note first (persisted state is unchanged, but injection behavior changes).
2. **Write the IM design before building any IM.** When the C-class IM entry comes, adopt the four DS-Bot rules above (pairing allow-list, provenance-scoped replies, no secret fill from chat, numbered approvals for platforms without buttons) as a spec, and read #1607 first as spec 18 says. Do not build a platform adapter now: the Mac/iOS/push path already serves the owner, and eight adapters is the maintenance cost DS-Bot carries.
3. **Add a "does it help on held-out tasks" stage to any change that writes skills or memory automatically.** DS-Bot's `learning-eval` runs decide and effect stages with an unrelated control. cairn's eval ruler (`integration/eval/**`) is the right home; the judge must stay untouched by agents, so this is a new case set, not an edit of the ruler. Touches `docs/spec/29`.
4. **Windows build for the desktop app.** The second-person criterion (`docs/spec/18` §2) is hard to meet for anyone not on a Mac. DS-Bot documents the unsigned-app warning flow for both OSes. Touches `apps/desktop/electron-builder.yml`, `apps/desktop/signing`. Large; needs an owner decision on priority.
5. **One-page threat model** (`SECURITY_MODEL.md` shape: components, entry points, assets ranked, attacker profiles, accepted risks). Cheap, and gives `/security-review` a starting point. Touches `docs/security/`. Note cairn's own rule: security surfaces list lives in `packages/shared/merge-gate-paths.json`, so link, do not copy.

## 4. Not worth copying

- **Group chats of persistent bots.** The cost DS-Bot admits (README) and the ledger/batch machinery it needed (message-ledger plan) exist to keep several chatting identities consistent. cairn's dispatch model avoids that class entirely.
- **Private bots, multiple Main Bots, per-bot rights.** cairn is for one person (`docs/spec/18` §1).
- **Sponsor block in the README** and the DSH-plugin packaging. Not relevant to cairn.
- **Daily automatic memory tidy.** cairn retired it deliberately.

## 5. How DS-Bot's IM layer works (source read, 2026-11-17)

Read: `ds-bot/src/host/im/index.js` (1,559 lines, `install(rt)`), `im/platforms/{index,telegram,feishu,weixin,retry}.js`, `shared/im-platforms.js`, headers of the other adapters. Base: https://github.com/Fei2411/DS-Bot/tree/HEAD/ds-bot/src/host/im (all verified unless marked).

- **Two layers.** One adapter file per platform (`adapters = { telegram, discord, slack, qq, dingtalk, wecom, feishu, weixin }`) and one core that owns pairing, routing, cards and send queues. An adapter exports `check(fields, env)` (validate credentials, return the account) and `connect(fields, env, handlers)` returning `{ send, edit, typing, stop }`. The core receives `onMessage`, `onAction` (button press) and `onStatus`. `env` injects `fetch` and `WebSocket`, so tests fake the network.
- **Always outbound.** Telegram: `getUpdates` long poll (50 s), offset persisted. Feishu/Lark: WebSocket long connection with protobuf frames, replies as interactive cards edited by PATCH. WeChat: Tencent iLink, QR login, `getupdates` long poll, a per-user `context_token` needed to reply, ~1,800-char chunks. Slack Socket Mode, Discord Gateway, DingTalk Stream, WeCom long connection, QQ gateway (from the IM plan table; those headers not read). Several protocol mappings are ported from MIT-licensed `dsh-im` and the Lark SDK and listed in its NOTICE.
- **One inbound shape.** `{ chat: {key, kind: direct|group, title}, sender: {id, name}, text, images, files, mentioned, messageId }`. Group messages count only when the bot is mentioned.
- **Pairing.** An unpaired sender is recorded as a request and gets one "requested" reply; the user approves in settings; `conn.paired` is the allow-list. Button presses from unpaired users are ignored. WeChat's scanner is paired automatically.
- **Reply routing by origin (the core idea).** In memory only: `origins: sessionId → { connId, chatKey, senderId, binding }`. A reply leaves only if the origin exists, the connection runs, the sender is still paired, and the chat still points at the same bot or group (`originOf`). When another source writes into the same session it goes into a `mixed` set and never goes to IM again. After a restart there is no origin, so nothing is sent.
- **Send queue per chat.** Serial. Failures are classed permanent / drop / retry; retry uses 4 attempts, 5 s doubling to 30 s, and honors `retry_after`. Failed messages are kept for a "try again" action. Text is chunked per platform limit; HTML/markdown that the platform rejects is resent as plain text.
- **Connection retry.** Waits of 250 ms growing to 30 s and then steady (`retry.js`). A refused token or a 409 (another program owns the bot) stops with an error shown in settings.
- **Commands and cards.** `/start`, `/stop`; a message of only digits answers the newest open question or approval card if it clearly fits, otherwise it is an ordinary message.
- **Secrets and process.** Credentials become host secrets named `IM_<PLATFORM>_<id>_<FIELD>`, scrubbed from error text. Only the process that holds the team lock connects.

Fit for cairn (inferred): the origin map is the same idea as the `provenance=` tag on Coordinator wakes in `docs/design/mail-connector.md`; an adapter layer would sit beside `apps/server/src/services/push.ts` and `notify_user`, and Telegram is the cheapest first adapter (plain HTTPS long poll, no public address).

## 6. What I did not check

Checked after the first version (verified): cairn memory rows (`agent_memory`, `apps/server/src/db/schema.ts`) have no pin and no `until`; they have `invalidAt`, `supersededBy`, `history`. cairn has a usage page (`apps/web/src/routes/usage-page.tsx`) fed by `/api/teams/:id/usage/daily`; the SQL groups by thread and model, and I did not confirm the page shows a per-model breakdown.

Still unchecked:

- DS-Bot's host code and running behavior; every "DS-Bot does X" above is from its own design text.
- Whether cairn's memory rows have a pin; whether cairn's web has a token usage page (only saw `"对话用量"` strings in `apps/web/src/i18n/en.ts`, speculative that it is per thread, not per agent/model).
- Whether cairn's browser/computer features match DS-Bot's in practice; both only compared at design level.
- Star count growth and user feedback; the 8,132 stars is a popularity signal, not an assessment of quality.

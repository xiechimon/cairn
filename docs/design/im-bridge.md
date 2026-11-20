# IM bridge: inbound buttons, attachments, and iMessage over the machine stream

Status: design for phases 1b+1c of [remote-reach](remote-reach.md). Builds on [im-connections](im-connections.md); research: [remote-reach-2026-11-20](../research/remote-reach-2026-11-20.md).

## Buttons and actions (1c)

- `ImOutboundMessage.buttons` must survive the `im-send` effect ledger: the payload JSON carries `buttons` and an optional `card` (`{requestId}`), and the dedupe key includes the button rows so a re-asked card is a new effect.
- Card text comes from the existing `notifyQuestion` path: `notifyChiefMessage` gains an optional `{requestId}` and the IM runtime hook becomes `notice(threadId, text, card?)`. For each claimed IM-only turn on the thread, a pending single-question card renders its options as one button row; anything else sends text only.
- Button value grammar: `imcb:<requestId>:<optionIndex>` — short enough for Telegram's 64-byte `callback_data`, opaque to the adapter.
- Inbound action shape: `{chat, sender, value, messageId}`. Telegram `callback_query` (dedupe key `cq:<query-id>`, ACKed via `answerCallbackQuery`); Slack `interactive`/`block_actions` Socket-Mode frames (dedupe key `slack-ia:<envelope_id>`, ACKed by the existing envelope ACK).
- Core `onAction`: session + row must exist, `imSeenInbound` dedupes, unpaired senders are ignored (rule 4). The requestId resolves to a `chiefMessage`; only a `pending` card answers. A proposal card maps the tapped label to the existing `allow-once | always | refuse` decision and runs `answerProposal` + `publishQuestion` + `dispatchActionWakes` — the same path the web answer route uses, `decidedBy: im:<senderId>`. A plain question card goes through `answerChiefQuestion`; when that enqueues a parked-resume turn, the turn copies the IM origin so its reply returns to the chat. Answering a proposal sends the card-ending sentence back into the chat; a held turn's own finish carries the outcome.
- Origin scoping: a card requestId the IM side sent counts as IM-owned (`im-send` effect payload records it), so `turnIsImOnly` stays true across restarts; a card answered on the web still taints the turn to `mixed` exactly as today.

## Attachments (1c)

- Inbound shape gains `files` beside `images`, both `{name, mimeType, dataBase64}`; `dataBase64` absent means "media seen, bytes not fetched".
- Telegram: `getUpdates` accepts photos (largest `photo` size) and `document`; bytes come from `getFile` + the bot-file endpoint, skipped past the 10 MiB cap or on fetch failure. Slack: `message` events with `subtype: file_share` fetch each `files[].url_private_download` under the bot token. iMessage (1b): the bridge reads `attachments[].original_path` on the mini and uploads bytes in the event body.
- Core stores each fetched file as a normal `attachment` row (`scope: 'message'`, `status: 'ready'`, `createdBy: im:<connId>`) under `attachmentsDir`, using the same filename/mime sniffing as `attachWorkerFile`; un-storable files are counted, not fatal. The inbound prompt lists `[附件 attachmentId=<id> name=<name>]` so the Coordinator opens them with the existing `attachment` tool. An empty-text media message is a valid turn.

## iMessage bridge (1b)

- New stream events on `/api/machine/stream`: `im.attach {connId}`, `im.detach {connId}`, `im.send {connId, sendId, message:{chatKey,text,replyToMessageId?}}`. Unknown-event-tolerant: old daemons drop them by schema parse; new daemon + old server simply never emits them.
- New machine-authed endpoint `POST /api/machine/im/:connId/event`: `{kind:'message', message}` | `{kind:'status', status, detail?}` | `{kind:'sent', sendId, ok, errorKind?, error?}`; the connId's bound `machineId` (stored in the connection's sealed fields) must equal the bearer machine, else 403.
- Server side, `services/im/imessage.ts` is a normal `ImAdapter`: `check` verifies `machineId` is a machine row of the team; `connect` registers `{connId, machineId, handlers}` in an in-memory bridge hub. `send` pushes `im.send` to the machine stream and awaits the `sent` report (30 s → retry-class failure; machine offline → retry-class). `stop` pushes `im.detach` and fails pending sends. On machine stream (re)connect the hub re-emits `im.attach` for every live conn bound to that machine — the daemon side is stateless across stream reconnects.
- Daemon side, `imsg-bridge.ts` runs beside the claim loop: `im.attach` resolves `imsg` (`CAIRN_IMSG_BIN` → managed `~/.cairn/imsg/` → PATH; managed install downloads the pinned `imsg-macos.zip` release, verifies SHA256, no postinstall), spawns `imsg rpc`, calls `initialize` then `watch.subscribe {attachments:true}`, and posts `status` + `message` events upstream. `im.send` issues `send {chat_guid, text}`; `-32001` maps to drop (delivery unknown), `-32002`/`-32004` to retry (poisoned lane → respawn), `-32602` to permanent, others retry. Own-send echoes are suppressed by guid plus a recent `{chat,text}` window. Child exit → `degraded` + respawn with backoff while attached.
- Identity: messages land from any chat the owner messages in; the self-chat works because inbound accepts `is_from_me` rows that are not our own sends. `chat_key` = `chat_guid` (stable); `sender.id` = raw `sender` handle (`'self'` when empty); `messageId` = `msg-<rowid>`; group chats require no mention rule (iMessage has no @-the-bot).

## States and failures

| Path | Write | Read | Failure |
|---|---|---|---|
| effect `im-send` + buttons | `enqueueSend` | `imSendPayload` in `runEffectRow` | malformed → `failEffect`; offline → `waitEffect`; per send error class |
| `onAction` | adapter → `imSeenInbound` + answer services | card row | unpaired/unparseable/stale card → ignore; proposal errors surface as ending text only when sent |
| attachments | `onMessage` → `attachment` rows | prompt lists ids | invalid name/mime/oversize → skipped, count noted; partial keeps stored ones |
| `im.attach` | hub on adapter connect and on stream subscribe | daemon bridge | machine offline: queued sends wait as retry-class effects |
| `im.send` | hub `send` | daemon `send` rpc | timeout 30 s → `sent ok:false` → retry; conn deleted → effect scopeGone cancels |
| `im event` POST | daemon | hub → handlers | unknown conn or wrong machine → 404/403 |
| `imsg` child | bridge spawn/respawn | notifications | crash → degraded + backoff respawn; `-32004` poison → respawn before retry |

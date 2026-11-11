# Message-first sending: prior art

Read on 2026-11-11 through agent-reach (Exa search, Jina read). Claims are verified (read first-hand), inferred, or a guess. Chat-product apps were not operated this session; each row says what was read.

| Source | How it does it | Trade-off | Link |
|---|---|---|---|
| Matrix Client-Server API | Verified. `PUT` carries a client `txnId`. The server treats the same id on the same path as a retransmission and returns the original status and body, including the original `event_id`. Scope is one device and one endpoint. | The id is not a second message store. A retry on a different path is a different request. | https://spec.matrix.org/latest/client-server-api/ |
| Slack `chat.postMessage` | Verified as far as the current method page goes. The argument list does not document `client_msg_id`. The error table names `duplicate_channel_not_found` and `duplicate_message_not_found` for that field. | Do not assume Slack returns the stored message. The page that was read does not say that. | https://docs.slack.dev/reference/methods/chat.postMessage/ |
| tus 1.0 | Verified. `PATCH` with `Upload-Offset` resumes a byte range. `HEAD` reports the offset. The server keeps an upload URL until the length is reached. | A second protocol, a second auth story, and a URL that outlives the 5-minute grant cairn uses today. | https://tus.io/protocols/resumable-upload |
| Amp manual | Verified. Attachments upload with the composer (100 MB, 512 MB for some accounts) and can include video. A message sent while the agent is working is steered or queued. No outbox or idempotency key is documented. | Useful for the attachment ceiling, not for the retry rule. | https://ampcode.com/docs/orbs/files-and-attachments and https://ampcode.com/docs/prompting |
| Cursor | Inferred from forum replies, not from docs.cursor.com. A failed send offers Try again; one report says retry can stick until the chat is reloaded, and the prompt is then gone. | The failure mode cairn is leaving: the text lives in the composer until the request returns. | https://forum.cursor.com/t/network-connection-failed-retry-doesnt-work/29284 |
| claude.ai | Not operated. Public search did not return a first-party send-failure or outbox spec. A userscript describes a Send button that stays in the composer until the request is accepted. Guess: the product awaits the send. | Not evidence for a ledger. | https://platform.claude.com/docs/en/api/errors (API retries only) |
| Claude desktop Code tab | Not operated. No first-party page read. | Dropped as an app session, not as a silent skip. | — |
| t3code | Not operated and no send-idempotency page found in this pass. | Same. | — |

## Pattern that fits

Verified from the Matrix spec, inferred for cairn: one client id, one route, and a retry returns the stored response. The outbox that survives reload is the client's job. The server does not need a second delivery table.

tus does not fit the current 10 MB cap and the single-use grant. Whole-file retry with a new grant does.

## Recommendation

Keep cairn's `client_message` ledger as the retransmission record. Persist the id and the route in a client outbox. Do not add tus or a video type until the size cap is raised on purpose.

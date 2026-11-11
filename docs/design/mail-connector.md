# Mail connector

Status: proposal for the owner's review. Nothing here is built. Owner route: a later implementation touches the secrets service and adds an unauthenticated inbound endpoint. This page does not change code.

Completes to-do item: Mail that reaches the owner without polling. The checkbox stays unticked until #3924 merges.

## Problem

The owner wants new mail in two mailboxes to reach him without a poll loop, and wants the Coordinator to raise only what matters. Mail is written by strangers. It is data, never instructions.

## What exists

Checked on `origin/main` (`f6411d379`). No Gmail, IMAP, Pub/Sub, or inbound webhook code.

| Need | Where it stands |
|---|---|
| Wake | `enqueueChiefStep` in `apps/server/src/services/chief.ts` inserts a chief step whose prompt starts `[wake:…] provenance=`, then calls `wakeCoordinator`. `apps/server/src/index.ts` wires that to `coordinator.wake`. A missing coordinator makes the wake a no-op; the step row remains. |
| Speak to the owner | `notify_user` (`apps/server/src/services/chief-tools.ts`) writes a chief message and `notifyChiefMessage` (`apps/server/src/services/notifications.ts`). It does not call push. |
| In-app notice | `notification` rows, id `${userId}:${entityId}`, channels only `in_app`. Types are the closed enum in `packages/shared/src/records/notification.ts`. One row per entity: a later upsert replaces the snippet. |
| Web push | `pushToUserSafely` in `apps/server/src/services/push.ts`. Callers today: `apps/server/src/services/owner.ts`, `chief-questions.ts` (questions, not `notify_user`), `chief-report.ts`. No-op when VAPID is null, the user is viewing that href (`isViewingThread`), or the href is a silenced todo. `queuePushDigest` / `sweepPushDigest` batch the rest. |
| Secrets | `apps/server/src/services/secrets.ts` seals `valueCipher` and never returns it from `toSecretRecord`. `openSecretValues` is how a step receives secrets (`apps/server/src/services/credentials.ts`). Chief steps get `secrets: {}`. `get_secret` in `apps/daemon/src/secret-channel.ts` returns the value to the model when a step was granted the name. |
| OAuth | `apps/server/src/services/oauth.ts` and `GET /api/oauth/callback` cover provider presets and GitHub only (`packages/shared/src/records/provider.ts`). |
| MCP | `apps/server/src/services/mcp-face.ts` is cairn's own server at `/api/mcp`. `apps/server/src/services/mcp-servers.ts` only lists the host Claude config. No connect flow, no token store, no invoke. |
| Public origin | `CAIRN_WEB_ORIGIN` (`apps/server/src/config.ts`) is the web origin push links use. It defaults to `https://cairn.local`. There is no stored public API origin. Session-token middleware skips `/api/oauth/callback`, `/api/mcp`, and `/api/machine/*` (`isExempt` in `apps/server/src/lib/token-auth.ts`). Anything else under `/api/` requires the session token. Machine routes use their own credentials. |
| Timers | `createDueRunner` in `apps/server/src/services/scheduler.ts` already runs named `due_event` kinds with backoff (`apps/server/src/services/due-events.ts`). |
| Third-party text | `fenceIssueText` (`packages/shared/src/records/prompts.ts`). `shortEvent` (`packages/shared/src/chief-event.ts`) omits that fence from the short event line. `validateMemoryText` (`apps/server/src/services/memory.ts`) refuses to save it. |

`apps/server/src/services/browser-session.ts` is the web auth cookie. It is not a mail or browser-control surface.

## Recommendation

One server-side connector, not a stdio MCP process and not a daemon mailbox loop.

A stdio server whose environment holds the token would put the token in a file `mcp-servers.ts` already lists, and a model that can spawn that process can read it. `get_secret` must not be granted these names either. The connector opens the cipher inside the server process and returns only fenced text.

Gmail uses a mailbox watch and a Pub/Sub push to this server. QQ Mail uses one held IMAP IDLE connection on the server. Both write the same event row. The daemon stays out of v1: a new machine route would widen the command boundary for a socket that does not need the desktop. If the server cannot reach the IMAP host, the account is `degraded` and the owner is told. There is no poll that pulls bodies into a prompt.

No tunnel client ships in cairn. The webhook URL is an owner-set public API origin, not `CAIRN_WEB_ORIGIN` and not the request host (a forwarded proto is not a registration target). If that origin is unset or not public `https`, watch registration fails closed.

v1 is inbound only. Sending mail is a later confirm-once action (`docs/design/ai-native-actions.md` is not built). This page does not add a second inbox. Needs-you mail wakes the Coordinator thread that already exists.

Rules are owner-written and deterministic. No model ranks mail. A model ranker would be another place for injected text to choose a tool call.

## State

`mail_account`: `disconnected`, `connecting`, `watching`, `degraded`, `revoked`.

`mail_event`: `received`, `ranked`, `delivered`, `dropped`. Unique on `(accountId, externalId)`. Gmail `externalId` is the message id, not the history id. IMAP `externalId` is `uidvalidity:uid`, so a UID reused after `UIDVALIDITY` changes is a new event, not a duplicate. The account also stores the history watermark, current `UIDVALIDITY` and last reconciled UID per mailbox, configured push service-account email, and a monotonic generation. Every connect/disconnect advances the generation; async work captures it and may commit events, watermarks, retries, or delivery only while it still matches an active account. Disconnect and these commits serialize in the database.

`mail_rule`: owner rows. Match kind is sender allow or subject contains. Rank is `needs_you`, `can_wait`, or `drop`. No match means `can_wait`.

A secret row holds the refresh token or the app password. Its name is not grantable to a step. `openSecretValues` and `get_secret` refuse it.

## Transitions

| From | To | Who |
|---|---|---|
| `disconnected` | `connecting` | Owner starts connect. No secret row yet. |
| `connecting` | `watching` | Secret sealed; Gmail watch baseline and catch-up job committed, or IMAP initial UID baseline persisted and reconciliation complete; renewal armed. |
| `connecting` | `disconnected` | OAuth denied, seal failed, or origin not publicly reachable. Delete any partial secret. |
| `watching` | `degraded` | IDLE drop, watch renew failure, history fetch failure. Watermark does not advance. |
| `degraded` | `watching` | Renew or reconnect succeeded. |
| `watching` or `degraded` | `revoked` | Provider rejected the token. Stop the socket and the watch. Do not retry the token. |
| `revoked` | `connecting` | Owner reconnects. New secret. Old cipher deleted. |
| any | `disconnected` | Owner disconnects through the cleanup path below. Events stay as ids without bodies. |

Event: history fetch or IDLE line accepted → `received` (ids only) → fetch metadata inside the connector → `ranked` by rules → `delivered` or `dropped`. A Gmail push does not create this row. A `dropped` row stores the id and the reason, not the body.

## Paths that read or write this state

| Path | Reads | Writes | On failure |
|---|---|---|---|
| Connect (owner, new route beside `oauth.ts`) | owner-set public API origin, existing account | secret via `createSecret`; first Gmail `users.watch` response `historyId` and expiration stored with `watching` and an unconditional catch-up `due_event` in one transaction, after a non-deliverable inventory of message ids that already exist at that baseline | Origin unset, not public `https`, or provider error: account `disconnected`, no secret left, partial watch cleaned up through the disconnect path. The inventory is `dropped` rows, reason `pre-baseline`, ids only, no body and no wake, committed before `watching`. A later 404 treats those ids as already stored and does not rank them. Pushes received while connecting are acknowledged without ingestion; activation catch-up always calls history from the stored baseline, so an immediate notification before commit is not lost. Renew preserves the last ingested watermark. |
| `openSecretValues` / `get_secret` | secret names granted to a step | nothing for mail | Mail names are refused even if a routing rule lists them. The step sees the same miss as an unknown name. The value is not logged. |
| Gmail webhook (new path, own verifier, not added to `isExempt` without that verifier) | account by the push's mailbox id, configured push service-account email and audience, generation | one coalesced history-fetch `due_event`, or nothing. Not a `mail_event` | Verify Google signature, issuer, audience, `email_verified=true`, and exact `email` match to the configured push service account. Bad identity or unknown mailbox: 401, no row, no wake. Inactive account: acknowledge without work. A push carries only the mailbox and a `historyId`, not a message id ([Gmail push](https://developers.google.com/workspace/gmail/api/guides/push)). Store that history id as a fetch hint. Do not use it as `externalId`. Ack only after the fetch job commits. Body is not logged. |
| History fetch (connector only) | watermark, secret opened in-process | one `mail_event` per message id (`externalId` is the message id, not the history id), watermark only after that paginated run commits | Fetch fails: watermark unchanged, account `degraded`, retry the same fetch. No wake. `users.history.list` 404 means the saved `startHistoryId` expired ([history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)). Do not retry that id, and do not take the replacement watermark from a later `users.getProfile`. Follow [full sync](https://developers.google.com/workspace/gmail/api/guides/sync#full_synchronization): the candidate baseline is the `historyId` of the newest message in `users.messages.list`, or `users.getProfile` only when that list is empty and the id was captured before the list returned. Before storing it, `users.history.list` from that id and insert any message id the list missed. Commit the watermark only after those events commit. A deliverable event is inserted only for an id that is not already stored, so `pre-baseline` inventory rows are not ranked or delivered. A message that arrives during recovery is in that history replay and is still delivered. If the list or the replay does not finish, keep the old watermark, stay `degraded`, and retry. Do not mark the gap skipped. |
| IMAP SELECT / reconcile / IDLE (connector only) | account generation, mailbox `UIDVALIDITY`, persisted last reconciled UID, secret in-process | On first connect, persist `UIDNEXT - 1` as the new-mail baseline; after every SELECT and IDLE update, search/fetch all UIDs greater than the cursor, durably insert deduplicated events, then advance cursor and enter IDLE | Socket drop: `degraded`, backoff reconnect, same cursor. Advance only after all discovered UIDs are persisted; retry is idempotent on `uidvalidity:uid`. On epoch change discard old callbacks, reset cursor to zero, reconcile all current UIDs as the new epoch before IDLE. Keep processing arrivals during catch-up and IDLE entry; no polling loop. |
| Watch renew (`due_event` kind, handler next to the scheduler map) | account, secret in-process | `watchExpiration`, next due time | Failure: `degraded`, backoff, no second watch if the old one might still be live. 401: `revoked`. |
| Rule edit (owner only) | rules | rules | Agent and MCP face have no write tool. A bad rule is rejected and the old rows stay. |
| Rank | rules, event id | `rank` | No body available: stay `received`, do not rank from the webhook payload. |
| Deliver `needs_you` | event, coordinator thread, existing step id | one outbox row keyed by event id; chief step id is that event id (`enqueueChiefStep` already takes `id`); provenance `mail:<eventId>`; `notifyChiefMessage`; `pushToUserSafely` with `delivery.id` equal to the event id | Step insert and the move to `delivered` commit together. A retry that finds the step does not insert another. Notice id `${userId}:${threadId}` upserts. Push no-subscription, expired, or viewing the thread: in-app row still stands; push is not a reason to open a second turn. VAPID null: in-app only. |
| Deliver `can_wait` | event, generation, delivery state | Insert `queuePushDigest` item and mark event `delivered` in one database transaction, no chief step | Retry checks the terminal event under the same transaction and skips enqueue; crash rolls both writes back. A silenced href still marks delivered without an item. Digest send fails: existing sweep keeps the item. No Coordinator turn. |
| Deliver `drop` | event | `dropped`, no notice, no wake | — |
| Disconnect / cleanup retry | account generation, secret id, socket, watch | Atomically mark `disconnected`, advance generation, cancel renew/reconnect jobs and pending delivery, and persist cleanup work; close the live IDLE socket and cancel in-flight fetches; call Gmail `users.stop` before deleting its secret | Cleanup failure stays visible as pending cleanup with bounded backoff; retain the sealed credential only for stop until success or known watch expiry, then delete. Reconnect waits for cleanup so an old stop cannot cancel a new watch. Old callbacks cannot write, wake, push, or rearm jobs. |

User-visible push title and body are a fixed template naming the rule that matched, not the subject or the body. The href is the Coordinator thread, so `isViewingThread` suppresses push while that thread is open. The in-app snippet is the same template. Raw mail never enters `push.ts` or `notification.snippet`.

The wake prompt carries ids, the rule name, and a fenced excerpt. The server already notified. Prompt text is not the control. A turn whose provenance starts with `mail:` is default-deny at `executeChiefTool` (`apps/server/src/services/chief-tools.ts`) and at every entry in `machine-relay.ts`, including the `ask_user` path that does not go through the switch. The only permitted operation is returning the fenced body of this event. It is not a general history read of arbitrary ids. `CHIEF_TOOL_CATEGORIES` on main also includes organize and execute names (`create_todo`, `update_todo`, `delete_todos`, `schedule_todo`, `unschedule_todo`, `snooze_todos`, `create_project`, `update_project`, `connect_repo`, `create_skill`, `update_skill`, `set_secret`, `delete_secrets`, `cancel_builds`, `merge_builds`) plus `delete_memory`, `set_wake`, and the other private tools. A denylist of notify, memory, computer, shell, and `get_secret` would still let those run. They are refused before dispatch.

## Fence

Reuse the issue-fence shape, with a mail marker, not `ISSUE_FENCE_OPEN`. Excerpt is display name, subject, and a short text slice. No raw MIME, no attachment bytes, no tokens.

The live wake is untrusted only if the Coordinator's own prompt says so. `buildChiefSystemPrompt` in `apps/server/src/services/chief.ts` names `ISSUE_FENCE_OPEN` and nothing else. The mail marker is added to that third-party paragraph. The same marker is added wherever that constant is the trust boundary today: `shortEvent`, `validateMemoryText`, `apps/server/src/services/memory-consolidation.ts`, `chief-digest.ts`, `chief-report.ts`, `trajectory-curate.ts`, and `trajectory-reflect.ts`. A marker that only `shortEvent` omits still sits in the prompt as instructions.

- The mail-body read may return the fenced body of this event only. The fence stays on that text. If the implementation reuses the `read_history` name, the handler accepts only this event's id.
- Server-side allowlist, not the prompt: that one read, and nothing else. Every other chief tool and every relay, computer, shell, and secret path is refused before dispatch.

Protocol contracts: [Gmail push](https://developers.google.com/workspace/gmail/api/guides/push) returns the initial history baseline and immediately notifies; [IMAP RFC 9051 §2.3.1.1](https://www.rfc-editor.org/rfc/rfc9051.html#section-2.3.1.1) defines UID persistence and UIDVALIDITY for reconnect resynchronization.

## Failure acceptance

Implementation must first fail tests for: a Gmail push that stores a message-id event before history fetch; history.list 404 that retries the expired id, stores a `getProfile` watermark before the history replay, or ranks a `pre-baseline` id; a mail turn calling `create_todo`, `schedule_todo`, `set_secret`, `update_project`, or `ask_user` through `executeChiefTool` or `machine-relay.ts`; first Gmail notification before activation commit; restart after activation before catch-up; renew preserving an unprocessed watermark; IMAP mail arriving during outage/catch-up/IDLE entry and UIDVALIDITY reset; crash after digest insert before event transition (one item after retry); a valid Google token with the right audience but another service-account email; missing or false `email_verified`; disconnect during IDLE, renew, history pagination, and queued delivery; failed `users.stop` across restart; reconnect while cleanup is pending. Assert no post-disconnect event, watermark, wake, push, or renewal; assert the socket closes, stop retries persist, the secret is eventually deleted, and old-generation callbacks cannot affect a new connection. These contracts are review safeguards only: this docs-only PR cannot enforce them in absent connector code.

## Risks

- A webhook verifier bug is an unauthenticated write onto the Coordinator. The path is an external entry. Implementation is owner-routed (`token-auth.ts`, `secrets.ts`, `oauth.ts`).
- Pub/Sub push retries. Idempotency is the event unique key, not a 200 that forgot to store the id.
- IDLE on the server ties mailbox reachability to wherever the server runs. That is accepted in v1; see the open decision.
- `notification` collapses to one row per entity. Using the chief thread id replaces the previous chief snippet. The event rows are the record; the notice is a pointer. Do not mint a second inbox to keep every subject.
- Prompt injection that survives the fence still cannot send mail in v1, because send does not exist, and cannot call any tool except the fenced body read for this event, because the handler and the relay default-deny this provenance. The system prompt names the fence so the model is told; the handler is what holds.

## Open decisions for the owner

1. IDLE on the server (recommended) or on the daemon. Daemon IDLE needs a new machine route and is a wider command-boundary change. Choose it only if QQ Mail cannot be reached from the server.
2. Ingress. Recommended: an owner-set public API origin, fail closed when it is missing. Do not reuse `CAIRN_WEB_ORIGIN`. No embedded tunnel.
3. Default rank when no rule matches. Recommended: `can_wait`, not `needs_you`.
4. Whether a needs-you wake may call tools at all. Recommended: one mail-body read for this event, then stop. No other chief, relay, computer, shell, or secret tool.

## Open for implementation

These notes are not settled here. Implementation must close them before the connector ships. This page does not specify the procedure. Further notes on this page are the same deferral.

- Mail that arrives after `users.watch` returns and before the pre-baseline inventory finishes can be stored as `pre-baseline` and then skipped by catch-up. The inventory is not snapshot-bound.
- A `UIDVALIDITY` change resets the cursor to zero and can rank every current UID as new, because `(uidvalidity, uid)` no longer matches the old epoch. A stable cross-epoch identity is not specified here.
- History and full sync are not limited to inbound `messagesAdded`. A relabel, sent message, or draft can become an event. That filter is not specified here.

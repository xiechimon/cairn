# One SSE stream per browser tab

Why: over HTTP/1.1 a browser allows 6 connections per origin. Each tab held a team stream and one conversation stream, so three tabs exhausted the pool and ordinary fetches to the same origin hung (measured in `docs/research/streaming-transport-sse-vs-websocket-2026-11-17.md`, section 6).

## Before

- Team stream `GET /api/teams/:id/stream`: `ping`, `machine_presence`, `todo`, `build`, `notification`, `branch_sync`, `computer.command`, `computer.state`. Hub: `TeamStreamHub`.
- Conversation stream `GET /api/conversations/:id/stream`, one per followed conversation (the open task thread or the open Coordinator thread): `ping`, `message`, `text_delta`, `thinking_delta`, `step`, `activity`, `agent_todo`. Hub: `ConversationStreamHub`, which replays the buffered live text, thinking, activity and agent todo to a new subscriber.

## After

The browser opens only the team stream. Conversation events ride on it.

1. On connect the team stream sends `{type:'hello', connectionId}` first, then the usual first `ping`.
2. The client sets the followed conversations with `PUT /api/streams/:connectionId/conversations` and `{conversationIds}` (at most 16). The body is the whole set, so a repeat is idempotent and a removed id unsubscribes. The server diffs against the connection's current subscriptions and subscribes new ids on `ConversationStreamHub`, which replays buffered live state exactly as before.
3. A conversation event reaches the tab as `{type:'conversation', conversationId, event}` where `event` is the unchanged conversation event. The envelope keeps the existing `conversationId` field of `message` (the delivered-queue source) meaning what it meant.
4. Conversation `ping` is gone: the team stream's ping is the liveness signal and counts for every conversation.

Reconnect: the server forgets a closed connection and all of its subscriptions. The client's reconnect path runs `resyncConversations` (clears live text, thinking, activity and agent todo, invalidates all queries), the new connection sends a new `hello`, the client sends its full set again, and the hub replays buffers. Sending the set again after a failed `PUT` retries every 2 s while the connection id is current. A `PUT` for an unknown or closed connection is 404 and is dropped; the next `hello` restores the set.

Silence handling is shared: any event counts as business activity, in-flight work is the team guards or any followed conversation, and a reconcile refetches once and lets each followed conversation run its post-refetch check.

`GET /api/conversations/:id/stream` stays for the iOS client, which does not share the browser pool. No browser code opens it.

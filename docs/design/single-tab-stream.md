# One SSE stream per browser tab

A new Cairn user can leave a task open in several tabs and still load ordinary pages. The browser opens one team event stream per tab; the open task and Coordinator transcripts share it. No extra account, key, or user action is required. On HTTP/1.1, the previous two-stream design could consume all six connections to the origin with only three tabs (see `docs/research/streaming-transport-sse-vs-websocket-2026-11-17.md`, section 6).

## Attachment and follow state

1. `GET /api/teams/:id/stream` begins with `hello` (a connection ID and, on current servers, `followRevision: true`), then `ping`. Business frames share the connection; conversation frames carry the followed conversation ID in their envelope. A message can separately name its destination conversation during queue rollover.
2. The client sends the full desired set (at most 16) to `PUT /api/streams/:connectionId/conversations`. Versioned writes include a monotonically increasing revision. The server acknowledges the applied revision and does not apply older revisions or a plain write after a versioned one. The client accepts recovery only for the current attachment and desired revision. A legacy `204` or an explicit rejection of the revision field negotiates the unversioned follow protocol.
3. A versioned subscription resets its preview, then receives buffered live text, thinking, and activity for the followed conversation. These are live previews, not a history of missed frames. Frame IDs are attachment-local; there is no event replay, resume cursor, or `Last-Event-ID` recovery.
4. On transport failure the client closes the old `EventSource`, retires its follow writes, and opens a new attachment. Its `hello` clears old previews and the client sends its entire follow set again. Recovering reads start after the current follow acknowledgment. Failed follow writes can retry on the current attachment; a missing attachment, an invalid versioned acknowledgment, or an ambiguous legacy timeout can force replacement.

The standalone conversation stream remains available to iOS; the browser does not open it.

## Saved data and query refresh

The tab has one event-to-query mapping. It uses the frame's team, project, task, and conversation IDs (including both ends of a message rollover) to select related keys. Build frames include the owning project ID; for an older frame the tab can use a known parent task or a build already in the matching project result. A task frame also refreshes the task transcript in legacy follow mode: a saved row need not have a corresponding conversation message frame.

| Situation | Query transition and user-visible result |
|---|---|
| A frame affects a query | Cancel any pre-frame read, with or without existing data. Apply any authoritative frame patch to the committed snapshot, mark matching keys stale, and start fresh reads for active queries and interrupted prefetches. An idle inactive entry waits for its next reader. A failed replacement does not publish the cancelled response. |
| A frame cannot affect the query | Leave its cache and running request alone. A build in one project cannot interrupt the builds list for another. |
| Membership in a search cannot be decided from the frame or local data | Mark the search stale without cancelling its read. Coalesce hints for that key, then refresh an active search once after the quiet period and any running read. Older build frames without an identifiable project use the same deferred treatment for possible project lists. |
| A replacement attachment acknowledges the current follow set | Run the same refresh against all watched keys; inactive cached entries are marked stale. Ignore acknowledgments belonging to older attachments or follow sets. |
| A frame gap or business silence calls for reconciliation | Refresh the stream-backed keys once for the tab. A followed Coordinator clears its live preview only when a new successful transcript read confirms the turn ended and no conversation activity intervened. |

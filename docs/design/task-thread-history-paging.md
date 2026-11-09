# Task thread history paging

Status: proposed, waiting for coordinator review. Owner report 2026-11-09: opening a thread takes a long time and the messages appear gradually.

## Problem

Measured on the live stack (2026-11-09, `main` at `45f00e7f8`), thread #165, build `01a1bd80`:

| Measure | Value |
| --- | --- |
| Rows returned by `GET /api/conversations/<buildId>/messages` | 1,140 of 1,140, `nextCursor: null` |
| Response body (no compression) | 17.6 MB, 21.4 MB an hour later |
| Server time to first byte | 0.43 to 1.27 s idle, 9 s under host load |
| Click to all rows painted | 0.98 s idle, 5.3 s at 50 Mbit/s |
| Refetches of that body while the thread stays open and the run is live | 15 in 45 s, 250 MB |
| Thread with 197 rows, 1.2 MB | 0.35 s, one paint |
| Coordinator thread (already paged, 100 of 7,940 rows) | 160 KB, 0.1 s |

Main-thread work is small next to the bytes: `JSON.parse` of the 17.6 MB body takes 50 to 120 ms, and the longest task while rendering 1,140 rows is 0.48 s. The time goes to building, sending and refetching the whole transcript.

Three causes, in order of weight:

1. The task branch of the messages route returns every row (`apps/server/src/routes-builds.ts:111`). The Coordinator branch of the same route already pages newest-first with `before` and `limit` (`chiefMessagePage`, `apps/server/src/services/coordinator.ts:20`).
2. Every `message` event on the conversation stream invalidates `['messages', id]` (`apps/web/src/api/sse.ts:231`), so each new row refetches the whole transcript although the event already carries that row.
3. The `merge_gate_run` record copies every assistant row of the build into `rawOutput` (`apps/server/src/services/merge-gate-run.ts:431-439`): 7.5 MB of the 17.6 MB is one row duplicating the other 422 tool-call rows. Its readers need only the review step's output.

## Prior art

| Source | History load | Live rows | Long lists |
| --- | --- | --- | --- |
| cairn Coordinator thread (`useChiefMessages`, `ChiefEarlierLoader`) | newest 100, `before` cursor, earlier pages on scroll to top | refetch | none |
| t3code `c6ca605` (`apps/web/src/components/chat/MessagesTimeline.tsx`) | not checked | pushed into client state | `@legendapp/list` with `maintainScrollAtEnd` |
| multica (`docs/research/r15-multica-run-rendering.md`) | not checked | pushed | `react-virtuoso` in the transcript dialog |
| Slack `conversations.history` (public API docs, not walked) | newest-first, `limit` plus cursor | events | not checked |

Choice: one paging contract for both conversation kinds, the one cairn already ships, consumed with TanStack Query `useInfiniteQuery` (already a dependency). Virtualization is out of scope: after paging, a page is 100 rows, and the measured render cost of 1,140 rows is under 0.5 s.

## Design

- **Wire.** The task branch accepts the existing `conversationMessagesQuerySchema` (`before`, `limit` default 100, max 200) and returns `nextCursor` the way the Coordinator branch does, ordered by `createdAt` then `rowid`. `queuedMessages` and `steerPending` stay on every page. A `before` id that is not in this conversation is a 404. The two branches share one page function; the unpaged query is deleted.
- **Client.** `useMessages` becomes the same infinite query as `useChiefMessages`; the two merge into one hook. `use-thread-chat` loads earlier pages through the existing earlier-loader on scroll to top. `mapTranscript` gets `hasEarlier`: while it is true, the head items (`run`, `injected-skills`, `scheduled`) are not rendered, and a tool echo whose call is on an unloaded page renders nothing rather than a note.
- **Live rows.** A `message` event writes its row into the newest page of `['messages', id, 'pages']`, deduplicated by id, and does not refetch. Reconnect (`resync`) and send or edit mutations refetch only the newest page: they reset the query to its first page, so a reconnect costs one page, not all loaded pages.
- **`merge_gate_run`.** `rawOutput` holds only assistant rows created inside the latest review step's window (`claimedAt` to `finishedAt`). Existing rows are left as they are.

## Readers and writers

| Path | Today | After |
| --- | --- | --- |
| Web task thread (`use-thread-chat.ts:116`) | whole transcript, refetched per event | newest page, rows appended from the stream, earlier pages on scroll |
| Web Coordinator thread (`hooks.ts:250`) | paged | same hook, unchanged behavior |
| iOS `CairnClient.messages` | follows `nextCursor` | unchanged, now also complete for task threads |
| `scripts/ops/restore-drill.py`, `restore-drill-api.mts` | follow `before` for Coordinator threads | unchanged |
| `scripts/ops/orb/canary-stack.mjs:382` | reads all task rows, finds `CAIRN_CANARY_RESULT=` | must follow `nextCursor`; migrated in the same PR |
| `merge-gate-run.ts` verdict parse | parses the last `VERDICT:` line of the whole transcript | parses the review window only; a test pins that an earlier review's verdict no longer counts |

## Failure modes and tests (red on `main` first)

1. A task thread with 1,000 seeded rows returns at most 100 rows and a cursor (today: 1,000 and `null`).
2. Paging back to the start returns every row exactly once, including rows sharing one `createdAt`.
3. A stream `message` event triggers no request to `/messages` and the row appears once.
4. A reconnect after loading three pages requests one page.
5. An e2e budget against a seeded 1,000-row thread: the first page paints with at most 100 rows, and the messages request is under 1 MB.
6. A `merge_gate_run` written after a long build is bounded by the review step's output.

## Rollout

Two PRs, each red-first: (1) wire plus client plus canary script, (2) `merge_gate_run` window. No migration and no flag: the response shape is unchanged, and clients that ignore `nextCursor` see the newest page only, which is the intended contract.

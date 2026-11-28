# Multi-tab stream starvation — method comparison, 2026-11-28

## The measured problem

On plain HTTP/1.1 (the normal tailnet / LAN setup, no TLS), browsers cap open
connections at **6 per host, shared across every tab of that origin**. Each Cairn
tab holds one long-lived `EventSource` team stream
(`apps/web/src/api/sse-connection.ts`, the only `new EventSource` in the web app;
conversation events are multiplexed inside it as `conversation` envelopes, see
`apps/web/src/api/conversation-subscriptions.ts`). The stream occupies a pool slot
for its whole life, so the 7th tab — and every short API request behind it —
starves.

Measured in production 2026-11-28: main tab + 5 more `/app` instances, after 15 s
only the first new one loaded; the other four stayed on "Loading the conversation"
(`apps/web/src/components/conversation-skeleton.tsx`). Main tab + 3: one showed
"Could not load the conversation", another "Connection lost, reconnecting".
Users hit this opening a task in a new tab, keeping Settings in another tab, or
running the desktop app and a browser tab against one server.

MDN documents the cap as per browser + per domain and marked "Won't fix" in Chrome
and Firefox. It is inherent to HTTP/1.1, not a Cairn bug in the stream code.

## Options comparable products use

### 1. HTTP/2 multiplexing

HTTP/2 shares one TCP connection across ~100 concurrent streams, so N tabs × 1 SSE
no longer exhausts a 6-slot pool. This is the standard production answer for SSE.

**Rejected for Cairn's setup:** browsers only negotiate HTTP/2 over TLS (h2c is not
supported by any browser). The tailnet / LAN deployment is plain `http://`, so
HTTP/2 is unavailable exactly where the bug lives. Requiring TLS would change the
deployment contract for every user.

### 2. One WebSocket per tab (chosen)

WebSocket is not counted against the HTTP/1.1 per-host pool (Chrome throttles
handshakes per renderer, not 6 per host). For a product comparison, Supabase
[Realtime](https://supabase.com/docs/guides/realtime/protocol) multiplexes
client channel joins and heartbeats on a WebSocket. Cairn already ships `ws` and a
`noServer` upgrade gateway for the computer screen
(`apps/server/src/services/computer-screen.ts`), so the server pattern exists.

Why it fits Cairn once the transport is negotiated rather than forced:

- **The browser pool stops mattering.** N tabs open N sockets, which no browser
  caps at 6 per host; short API requests always keep their pool slots.
- **Frames and recovery are unchanged.** The socket carries the same `{id, data}`
  serial frames as the SSE `id:`/`data:` lines, so `sse-connection.ts` keeps its
  watchdog, gap detection, backoff and recovery logic and every consumer of
  `onEvent` stays byte-identical.
- **Fixture blast radius is closed by negotiation, not by rewriting fixtures.**
  The server advertises `transport: 'websocket'` on
  `POST /api/auth/stream-ticket`; a client that cannot reach that endpoint (the
  Playwright fixture app has no backend, so the request 404s) keeps the plain
  stream path and every `window.EventSource` stub still sees its stream. Old
  servers keep SSE; old clients keep hitting the SSE route, which stays.
- **A failed upgrade cannot recreate pool starvation.** After the server advertises
  WebSocket the client retries a failed upgrade instead of switching to SSE. A custom
  proxy must forward upgrades for live updates. An old server and old clients still
  negotiate or use SSE as before.

Earlier drafts of this document rejected the WebSocket option on two grounds that
no longer hold: that it would force every e2e fixture off `EventSource` (negotiation
prevents that), and that it needs a new auth path (a stream ticket already exists
for SSE and redeems identically here).

### 3. One SharedWorker stream per origin

The SSE spec's own suggested workaround: open the `EventSource` inside a
`SharedWorker` so all same-origin tabs share one physical connection.

**Rejected:** the stream leaves the page context, so every page-level
`EventSource` fixture stub stops seeing it, and the per-tab `QueryClient`,
notification `clientId` targeting and presence pipeline would all need a
worker↔page RPC. More plumbing than option 4 for the same single connection, and
it moves code out of the tested page path.

### 4. Leader election + BroadcastChannel relay

One tab (the leader) holds a single `EventSource`; every other tab receives the
same frames over a `BroadcastChannel`. This is the pattern published as
`sse-coordinator` (npm) and used by cross-tab sync libraries such as RxDB's
`broadcast-channel` leader election.

**Rejected after review.** Leader election needs `navigator.locks`, which is
`[SecureContext]`-only: on plain `http://<server>:8787` — exactly the tailnet / LAN
setup where the bug lives — `navigator.locks` is `undefined`, so the plan degrades
to one stream per tab and fixes nothing. A 7-tab check on `127.0.0.1` is a secure
context and would have passed while production stayed broken. The relay also
introduces edges the direct transport does not have: followers that join after
`hello` need replay, leader change resets the frame counter under a follower's
`lastFrameId`, and the server must track a per-follower subscription set on one
connection.

## Decision

Option 2 with negotiated transport: the server advertises `transport: 'websocket'`
on the stream ticket, the tab opens one WebSocket per tab, and the SSE route stays
for old clients and server tests. Plan: `docs/design/multi-tab-streams.md`.

## Sources

- MDN EventSource — 6-connection limit per browser/domain, "Won't fix":
  https://developer.mozilla.org/zh-CN/docs/Web/API/EventSource
- SSE vs WebSocket connection limits (HTTP/1.1 6 per domain across tabs; HTTP/2
  ~100 streams; WS not browser-limited per host):
  https://env.dev/guides/server-sent-events/ ,
  https://howhttpworks.com/compare/sse-vs-websockets
- Chromium per-renderer WebSocket handshake throttling (~255 pending):
  https://chromium.googlesource.com/chromium/src.git/+/refs/tags/149.0.7784.0/third_party/blink/web_tests/http/tests/websocket/multiple-connections-throttled.html
- Chrome Energy Saver freezing — held Web Lock with external waiters exempts a
  group: https://developer.chrome.google.cn/blog/freezing-on-energy-saver?hl=en
- Page Lifecycle API — release Web Locks / close BroadcastChannel when frozen:
  https://developer.chrome.google.cn/docs/web-platform/page-lifecycle-api?hl=en
- `sse-coordinator` (BroadcastChannel single-SSE leader pattern):
  https://www.npmjs.com/package/sse-coordinator
- SharedWorker workaround suggested for HTTP/1.1 SSE:
  https://buildwithmostafa.hashnode.dev/server-sent-events-in-production
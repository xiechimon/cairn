# Live conversations across tabs — plan, 2026-11-28

## User scenario

A newcomer pairs a browser once and opens Cairn over plain HTTP on their LAN or tailnet. With several conversations or Settings open, later tabs can sit on “Loading the conversation” because older tabs' permanent streams fill all six browser HTTP/1.1 connections. Give each new tab one WebSocket for its existing live updates so the HTTP pool stays available. There is no new account, key, payment, setting or persistent data. An interruption uses the existing reconnect and history recovery behavior. A reverse proxy that strips WebSocket upgrades must forward them for live updates; the page does not fill the HTTP pool with fallback streams while waiting. [Alternatives and rationale](../research/multi-tab-streams-2026-11-28.md).

## Scope

1. Advertise WebSocket in the existing stream-ticket reply. On explicit legacy negotiation (old reply without the capability, missing endpoint) or in demo mode, retain EventSource. Retry transient ticket failures and rejected or timed-out upgrades with backoff. No transport probes or per-origin shared browser state.
2. Accept the existing team stream path on the main and tailnet HTTP listeners. Before upgrade, check path, team, origin and ticket/device identity. Only trust forwarded host/proto from configured proxies; the tailscaled Unix listener can receive either HTTP or HTTPS origins matching its host. The computer-screen upgrade keeps its own routes; close unclaimed upgrades.
3. The tab owns one stream; the server opens one fresh subscription, follow set and device binding per connection. The tab writes a follow PUT after `hello`; the server's hub and heartbeat write ordered frames, and the client consumes them through its existing recovery pipeline. No changes to presence, notification targeting, auth policy, or the conversation follow cap.
4. On failure or sleep/wake, discard the old connection and frames, obtain a new single-use ticket and recover after the new `hello` and follow acknowledgment. Auth gate teardown cancels attachment of a late ticket; server close, device revocation and queue overflow release the session. Close listeners to new connections before draining live transports during shutdown. Vite forwards upgrades on the same route for development.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Seven app tabs over HTTP/1.1 | Each opens a loaded conversation and holds its own WebSocket | `apps/web/e2e/multi-tab-streams.spec.ts` | this change |
| One tab closes | The surviving tab keeps receiving updates, with no leader to replace | `apps/server/test/team-stream-socket.test.ts` | this change |
| Server restart or sleep/wake drops the connection | The page reconnects with a new ticket and resyncs after subscribing again | `apps/web/test/stream-transport.test.ts`, `apps/server/test/team-stream-socket.test.ts` | this change |
| Proxy strips upgrades, or handshake never completes | Pages can still load; the existing connection indicator shows offline and retries without occupying the HTTP pool | `apps/web/test/stream-transport.test.ts` | this change |
| Old server or fixture does not advertise WebSocket | The tab keeps using EventSource; an old client can still call the legacy route | `apps/web/test/stream-transport.test.ts` | this change |
| Tab signs out while a ticket is pending | Disposing the tab stream prevents a late attachment; other tabs retain their existing cookie and device semantics | `apps/web/test/stream-transport.test.ts` | this change |
| Two servers in two tabs | Tickets and connections are scoped to each page's origin, with no cross-tab relay | `apps/web/e2e/multi-tab-streams.spec.ts` | later: two-origin browser coverage |
| Missing, reused or revoked device ticket; foreign origin or team | The server refuses the upgrade, without delivering a frame; device revocation also closes the active stream | `apps/server/test/team-stream-socket.test.ts` | this change |
| Screen stream, unknown upgrade path, tailnet TLS, or shutdown with tabs open | Screen and team sockets coexist; unknown paths close; tailnet users stay live; shutdown does not wait on open streams | `apps/server/test/team-stream-socket.test.ts`, `apps/server/test/tsnet-remote.test.ts` | this change |

## Out of scope

- Removing the legacy SSE route or changing iOS and runner streams.
- Installing TLS, changing proxy settings, or guaranteeing multi-tab streaming through proxies that block WebSocket. No production restart is required for verification.
- Additional transport-level dead TCP peer probes; the client already has a silence watchdog.

## Live confirmation

The regression runs against the real isolated HTTP/1.1 server. On the parent product source (`08a7a43a5`), the first six tabs acquired SSE streams and tab 7 timed out navigating to `/app` after 8 seconds. With the fix, all seven conversations loaded and all seven sockets were still open at assertion time. After deploy, require `/api/auth/session` to return 204 before opening any production pages. Open seven tabs on the mini, require a loaded conversation and socket `hello` in each, and save the contact sheet and health output under `~/Pictures/cairn-review/multi-tab/`.

## Review

- Verdict: PASS
- Plan-SHA256: 08ebf7232b6bbdf598ad77c7627cd8211a8d8f9d35004f0ec7f1d63e22ffadf6
- Author-Model: doubao-agent
- Reviewer: Pi fresh-context plan review and confirm-only re-stamp
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: Addressed the fallback starvation and probe lifecycle findings by removing downgrades; made the proxy limitation and uncovered cases explicit; verified the real seven-tab regression on parent and fixed source.

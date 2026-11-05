# P7 gateway and outbound adapter

This slice adds the authenticated binary gateway and the daemon adapter interface. It depends on the private ownership prerequisite in #2877. It does not complete the desktop provider, machine-loop consumer, dispatcher mutation fence, or browser screen panel.

## Failure modes and regressions

The tests were written before their corresponding behavior. The initial control API probe returned 404 instead of 201. Private ownership tests then exposed 201 responses for foreign private scopes; an additional regression exposed cleanup of an expired foreign lease on a denied request. All now pass.

| Boundary | Executable evidence |
| --- | --- |
| Owner API | `apps/server/test/computer-screen-routes.test.ts`: normal bearer authentication, same-team foreign/unknown/orphan scope denial on every operation, denied requests do not mutate foreign leases, JSON-only bounded bodies. |
| User control | `apps/server/test/computer-screen.test.ts`: active Coordinator exclusion, current takeover exception, cancellation acknowledgment window, lease identity/fence/renewal/expiry, restart and disconnect invalidation. |
| Viewer and machine upgrades | Same test: sealed subprotocol capability, same-app Origin, assigned machine bearer, query bearer refusal, tampering/replay/mode/generation/token revocation. |
| Binary proxy | Same test: actual loopback WebSockets, bidirectional binary bytes, greeting before viewer arrival, frame bounds, expiry and disconnect cleanup. |
| Outbound adapter | `apps/server/test/computer-screen-adapter.test.ts`: real loopback gateway and Unix socket with a stateful fake screen provider, existing machine Authorization header, late provider cancellation and asynchronous teardown fencing. |
| Cleanup failure | `apps/server/test/computer-screen-stream.test.ts`: failed resource release keeps the mutation predicate closed; view channels do not acquire it. |
| Wire compatibility | `packages/shared/test/computer-screen-protocol.test.ts` and `packages/shared/test/snapshot.test.ts`. |

## Live API contrast

An isolated in-memory database and live loopback Hono server used a connected synthetic machine, without a model or desktop. The request included an application/json body and the seeded user's canonical private chief scope.

| Request | Baseline without gateway | Implementation |
| --- | --- | --- |
| `POST /api/teams/:teamId/computers/:computerId/control` with `{}` | 404 | 201, opaque lease identifier, future expiry, fence 1, `cache-control: no-store`, `referrer-policy: no-referrer` |

A separate live Vite proxy probe failed before the proxy change with `WebSocket did not upgrade through Vite API proxy`. It passed after: four binary bytes echoed through the screen path and the browser-facing Host reached the backend unchanged. This verifies the development proxy mechanism, not a browser desktop session.

## Dependency API evidence

The approved scripts-disabled install pins ws 8.22.1 and its types 8.18.2, noVNC 1.7.0 and its types 1.6.0. Installed undici 8.10.2 accepts WebSocket initialization headers, so machine authentication reuses its existing bearer. A Chromium library probe completed a synthetic RFB handshake and observed a canvas, view-only input suppression and control key events. noVNC 1.7.0 exports its root ESM entry with top-level await; the older DefinitelyTyped declaration names the old `lib/rfb` path. The future browser consumer must supply the checked declaration bridge and use the root runtime export.

## Limits

The provider in these tests is a stateful fake. They prove gateway authorization, byte transport and adapter cleanup contracts. They do not prove a real rootless desktop's read-only endpoint, a real PTY process subtree, production daemon wiring, bot-versus-user arbitration in the dispatcher, or the final screen UI. A view-only browser flag is not provider authorization. Those integrations must consume this interface and receive their own runtime evidence before P7 is complete.

# Runner offline grace period

Tracking: #4596. Status: revision 2, awaiting a narrow design re-check. Baseline `origin/main` at `50827425b`. Revision 2 answers review items M1 to M5 on revision 1 (`99f5ea2bd`).

## Problem

A Runner turns offline the moment its push channel (`GET /api/machine/stream`) drops: `stream.onAbort` in `apps/server/src/routes-machine.ts` calls `markOffline`. Opening a new stream does not mark it online again; only the next presence post does (every 30 s), so each drop shows offline for 15 to 31 s. On omarchy on 2026-11-14 the channel dropped 24 times. While a flicker lasts, the composer tells the owner to connect a Runner (#4758), routing that prefers an online machine skips it, and a `machine_presence` offline event reaches every open page.

## Connections

Every stream gets a connection id: 128 random bits from the server, sent as the first stream event `{"type":"hello","connectionId":"..."}`. `MachineWakeHub` keeps, per machine, the current connection id and at most one pending grace `{connectionId, timer}`. Every state change below names a connection id and applies only if the id matches at the moment of the change, checked and written in the same synchronous block. A machine id or `isConnected` alone never authorizes a change.

Daemons that predate this ignore the unknown `hello` event (`hasKnownStreamEventType` in `machine-client.ts`) and never send goodbye, so they go through the grace period. A new daemon on an old server gets no `hello` and skips goodbye.

## Transitions

| Event | Condition | Effect |
|---|---|---|
| Stream opens with a valid token | Always | Becomes the current connection; cancels any pending grace; sets `online` and `lastSeenAt` and publishes online if it was offline |
| Server sees the stream abort | Its id is the current connection | Clears the current connection; starts a grace of `MACHINE_OFFLINE_GRACE_MS` = 45 s for that id |
| Server sees the stream abort | Not current (replaced or revoked) | Nothing |
| Grace timer fires | Pending grace id equals its id and there is no current connection | Clears the grace; `markOffline` |
| Grace timer fires | Otherwise, including a callback queued before cancel | Nothing |
| Goodbye `POST /api/machine/offline {connectionId}` | Id is the current connection or the pending grace | Clears both; records the id as the machine's ended connection; `markOffline` |
| Goodbye | Id matches neither | Nothing; `200 {"applied":false}` |
| Ping finds the token invalid | Its id is the current connection | Clears the connection, no grace; `markOffline`; closes the stream |
| Ping finds the token invalid | Not current | Closes the stream only |
| Revoke, re-enroll with the same key, enrollment authorization | Always | Unchanged: rotates or clears the token, `markOffline`, `revokeMachine`; also cancels any pending grace |
| Presence post | Carries the connection id that said goodbye | Ignored for `online`; nothing changes |
| Presence post | Otherwise | Unchanged: `online` and `lastSeenAt`. It does not cancel a grace, so the 45 s bound holds whether or not presence keeps arriving |
| `sweepStaleMachines` (15 s tick) | `lastSeenAt` older than 150 s | Unchanged; `markOffline` and cancels any pending grace. Offline wins over a running grace |

`markOffline` publishes only on the online-to-offline transition, so a timer, a goodbye and the sweep together produce one offline event.

Replacement order, M1's case: a second stream for the machine makes the first non-current and `revokeMachine` sends `shutdown` to the old daemon, whose `stop()` sends goodbye with the old id. That id matches neither the current connection nor a grace, so the new connection stays online.

## Daemon goodbye

`stop()` keeps today's order up to the stream abort: stop the timers, abort the stream and claim controllers. It then awaits `presenceReporter.close()` and only then sends goodbye with the last `connectionId` it received, using a 2 s timeout. A failed or timed-out goodbye is logged and does not block shutdown. Whether the abort or the goodbye reaches the server first, the Runner ends offline: goodbye matches the current connection or the grace the abort started.

`close()` aborts an in-flight presence post on the client, but the server may already have the request and process it after the goodbye. So a new daemon puts its last `connectionId` in every presence body (an optional field), and the server ignores `online` from a presence that carries the machine's ended connection id. A presence from an old daemon carries no id and is handled as today.

## Bounds

These are age thresholds checked by timers and a 15 s scheduler tick, so each can run late by event-loop delay.

| Case | Turns offline | Today |
|---|---|---|
| Clean stop, server reachable | When goodbye arrives (up to 2 s) | When the abort arrives |
| Stop with goodbye failing, or a crash the server sees as an abort | 45 s after the server sees the abort | At the abort |
| Network drop the server sees as an abort, no reconnect | 45 s after the abort | At the abort |
| Reconnect within 45 s | Never shown offline | Offline until next presence |
| Frozen or half-open daemon (`kill -STOP`, sleep, a silent network). The ping is one-way and unacknowledged, so the server may see no abort | When `lastSeenAt` is older than 150 s, up to 165 s | Same |
| Server restart. Grace timers are in memory and lost | Reconnect marks online; otherwise `lastSeenAt` older than 150 s | Same |
| Revoked or rotated token | At once | At once |

## Work and recovery during grace

- New step claims are pulled with a token check per request. A daemon that is gone makes no new claims. A long-poll claim already open when the Runner dies can still be answered; the abort signal and `stillAuthorized` checks stay as they are, and a step that reaches a dead socket is recovered by the abandoned-step sweeps below. This protocol has no delivery acknowledgment, and this design adds none.
- Recovery is not delayed. `sweepAbandonedBuildSteps` skips a progressed step while its machine is online, and `sweepAbandonedChiefSteps` releases only when the machine is offline. Both treat a machine with a pending grace as offline, through `MachineWakeHub.inGrace(machineId)`, so a step with an already stale heartbeat is released at the same sweep as today.
- Routing reads (`targetUnavailable`, `fallbackMachineId`, `platformFallbackMachineId`, `namedMachineForStart`, `step-queue`, Coordinator home) see the Runner as online during grace. An unpinned task routed to it can wait up to 45 s more before fallback. Pinned and default-Runner tasks wait for the Runner or a person's reroute, as #4596 decided; grace does not change that. `runner-offline` notices still wait 2 min after `lastSeenAt`.
- Pushed commands (branch sync, computer calls) check the live connection, which grace does not fake: during grace `pushSync` and `pushComputer` find no current connection and fail at once, so `branch-sync` returns 409 as it does today for an offline Runner.
- Existing limitation, not fixed here: `pushSync` returns true when the event is queued, and the stream route swallows a failed write. A sync queued just before a drop can stay `pending` or `running` with no timeout. Grace neither causes nor fixes this; it gets its own issue.

## Security boundary

- `online` grants nothing. Every machine endpoint authenticates the bearer token against `tokenHash` (`findMachineByToken`) on each request, and long-poll routes recheck it after each wait.
- Revoke, re-enroll and enrollment authorization keep marking the Runner offline at once, and now also cancel its grace, so a revoked or rotated credential is never shown online longer than today.
- Goodbye derives the machine only from `me(c)`, the current bearer token. It accepts no machine id, uses the `executeMachineCommand` pattern, and revalidates the token after reading the body, before any change. It can only mark the caller's own machine offline, and only for a connection id that machine holds.
- The grace length is a server constant; no request sets or extends it.
- Not a goal: a stolen token that is still valid is indistinguishable from the real daemon. It can post presence, open streams and say goodbye for its own machine, as it can today. Connection ids keep a replaced daemon from changing the current connection; they do not defend against the holder of the active token. Revocation is the remedy.
- `routes-machine.ts`, `services/machine*.ts` and `apps/daemon/src/machine-client.ts` are security surfaces. The code PR records `/security-review` against its exact head before it leaves draft.

## Tests

Server, Vitest with fake timers, through the HTTP routes. Each is a new behavior; existing revocation tests in `machine-revoke.test.ts` stay as they are.

1. Abort of the current stream: online at 44.9 s, offline at 45 s, one offline event.
2. A new stream within 45 s keeps it online with no event. A new stream after expiry marks it online at once and refreshes `lastSeenAt`.
3. Presence alone after an abort does not cancel the grace: offline at 45 s.
4. Replacement: stream A, then stream B, then A's late abort and A's goodbye change nothing; B stays online.
5. Rotation: re-enroll while stream A is open, the new daemon posts presence, then A's ping finds its old token invalid; the machine stays online.
6. Goodbye for the current connection and for a pending grace marks offline at once; a goodbye with an unknown id returns `applied: false` and changes nothing. A presence carrying the ended id after goodbye leaves the Runner offline; a new stream then marks it online.
7. Goodbye is rejected with no token, a wrong token, a revoked token and a rotated token. Token A with machine B's connection id, in the same team and in another team, leaves B's state, grace and stream untouched.
8. Revoke during grace: offline at once, and the old timer firing later changes nothing.
9. Two machines' graces are independent.
10. A stale `lastSeenAt` makes the sweep mark offline during grace with one event, and the timer then does nothing.
11. Build and Coordinator steps whose heartbeat is 119 s old when the stream drops are released at the same sweep as on the baseline.
12. Restart: a new server with the machine online in the database and no grace marks it offline only after 150 s without presence.
13. During grace, branch sync returns 409 and computer calls fail.

Daemon, Vitest: `stop()` waits for an in-flight presence post before goodbye, sends the last connection id, and a goodbye that times out after 2 s or fails does not block shutdown. A daemon that received no `hello` sends no goodbye.

Live on omarchy, on the deployed server, with a read-only watcher on `machine.online` and the server's abort log:

- Kill only the daemon's stream socket, chosen by its local port, with `ss -K`. The Runner stays online and reconnects.
- Stop the daemon. Offline within 2 s.
- `kill -STOP` the daemon for 200 s. It turns offline when `lastSeenAt` passes 150 s, not at 45 s; after `kill -CONT` it is online again on reconnect.
- Enroll a throwaway Runner, cut its stream, revoke it during grace. Offline at once and its token is refused. Remove it afterwards.
- One hour of normal load on the baseline and one hour with the change, measured the same way: stream drops, reconnect durations and visible offline transitions. Report drops masked out of drops observed, and the detection delay of each real outage.

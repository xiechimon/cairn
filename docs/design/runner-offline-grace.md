# Runner offline grace period

Tracking: #4596. Status: revision 3, accepted by design review on 2026-11-15. Baseline `origin/main` at `50827425b`. Revision 2 (`1614c51e9`) answered review items M1 to M5 on revision 1 (`99f5ea2bd`); revision 3 answers the re-check: presence admission (M1, M2) and recovery after fresh presence (M3).

## Problem

A Runner turns offline the moment its push channel (`GET /api/machine/stream`) drops: `stream.onAbort` in `apps/server/src/routes-machine.ts` calls `markOffline`. Opening a new stream does not mark it online again; only the next presence post does (every 30 s), so each drop shows offline for 15 to 31 s. On omarchy on 2026-11-14 the channel dropped 24 times. While a flicker lasts, the composer tells the owner to connect a Runner (#4758), routing that prefers an online machine skips it, and a `machine_presence` offline event reaches every open page.

## Connections

Every stream gets a connection id: 128 random bits from the server, sent as the first stream event `{"type":"hello","connectionId":"..."}`. `MachineWakeHub` keeps, per machine, the current connection id and at most one pending grace `{connectionId, timer, presenceSinceDrop}`. Every state change below names a connection id and applies only if the id matches at the moment of the change, checked and written in the same synchronous block. A machine id or `isConnected` alone never authorizes a change. Ids live in memory only; after a server restart every earlier id is unknown.

A daemon from this change sends `connectionId` in every presence body: `null` before its first `hello`, then the last id it received. A daemon that predates this sends no `connectionId` field, ignores the unknown `hello` event (`hasKnownStreamEventType` in `machine-client.ts`) and never sends goodbye. A new daemon on an old server gets no `hello`, sends `null` and skips goodbye.

## Transitions

| Event | Condition | Effect |
|---|---|---|
| Stream opens with a valid token | Always | Becomes the current connection; cancels any pending grace; sets `online` and `lastSeenAt`; publishes online if it was offline |
| Server sees the stream abort | Its id is the current connection | Clears the current connection; starts a grace of `MACHINE_OFFLINE_GRACE_MS` = 45 s for that id |
| Server sees the stream abort | Not current (replaced, revoked, already ended) | Nothing |
| Grace timer fires | Pending grace id equals its id and there is no current connection | Clears the grace; `markOffline` |
| Grace timer fires | Otherwise, including a callback queued before cancel | Nothing |
| Goodbye `POST /api/machine/offline {connectionId}` | Id is the current connection or the pending grace | Clears both; `markOffline` |
| Goodbye | Id matches neither | Nothing; `200 {"applied":false}` |
| Ping finds the token invalid | Its id is the current connection | Clears the connection, no grace; `markOffline`; closes the stream |
| Ping finds the token invalid | Not current | Closes the stream only |
| Revoke, re-enroll with the same key, enrollment authorization | Always | Unchanged: rotates or clears the token, `markOffline`, `revokeMachine`; also cancels any pending grace |
| Presence with the current connection id | Always | As today: `online`, `lastSeenAt`, reports |
| Presence with the pending grace id | Always | `lastSeenAt` and reports; sets `presenceSinceDrop`; does not cancel the grace, so the Runner still turns offline 45 s after the drop unless a stream returns |
| Presence with any other id: superseded, expired, ended by goodbye, or from before a server restart | Always | Writes nothing; `200` |
| Presence with `connectionId: null` | Always | `lastSeenAt` and reports; `online` unchanged |
| Presence with no `connectionId` field (daemon that predates this) | Always | As today: `online`, `lastSeenAt`, reports; during a grace it also sets `presenceSinceDrop` |
| `sweepStaleMachines` (15 s tick) | `lastSeenAt` older than 150 s | Unchanged: `markOffline`; also cancels any pending grace. Offline wins over a running grace |

So for a daemon from this change, `online` becomes true only through a stream open or a presence on the current connection. A Runner whose connection expired or said goodbye stays offline until a new stream opens; one the stale sweep marked offline while its connection is still current comes back on its next presence. `markOffline` publishes only on the online-to-offline transition, so a timer, a goodbye and the sweep together produce one offline event.

Orderings this closes:

- Replacement: stream B makes A non-current and `revokeMachine` sends `shutdown` to the old daemon. Its goodbye(A) and any late presence(A) match nothing, so B is untouched. If B then says goodbye, a later presence(A) still matches nothing, and the Runner stays offline.
- Expiry: presence(A) at 30 s is admitted for `lastSeenAt`; the timer marks offline at 45 s; presence(A) at 60 s writes nothing. A late goodbye(A) after expiry also does nothing, and nothing needs it to.
- Shutdown: `stop()` aborts the stream and claim controllers as today, awaits `presenceReporter.close()`, then sends goodbye with the last id and a 2 s timeout. A presence the server processes after the goodbye carries that id, which is no longer current or in grace, or carries `null`; neither sets `online`. A goodbye that times out on the client may still be applied later; it can only end that id, never a newer connection.
- Frozen daemon: the server may see no abort, so the connection stays current; the stale sweep marks it offline after 150 s. After `kill -CONT` the next presence on the still-current connection, or a new stream, marks it online.

Weaker guarantee for daemons that predate this: their presence keeps today's behavior, so a late presence from such a daemon can set `online` after it stopped, and the stale sweep corrects it after 150 s. They also get no goodbye, so a clean stop shows online for the 45 s grace.

## Bounds

These are age thresholds checked by timers and a 15 s scheduler tick, so each can run late by event-loop delay.

| Case | Turns offline | Today |
|---|---|---|
| Clean stop, server reachable | When goodbye arrives (the client waits up to 2 s) | When the abort arrives |
| Stop with goodbye failing, a crash, or a network drop the server sees as an abort, with no new stream | 45 s after the abort, whether or not presence still arrives | At the abort |
| Reconnect within 45 s | Never shown offline | Offline until the next presence |
| Frozen or half-open daemon (`kill -STOP`, sleep, a silent network). The ping is one-way and unacknowledged, so the server may see no abort | When `lastSeenAt` is older than 150 s, up to 165 s | Same |
| Server restart. Grace timers and ids are lost | A new stream marks online; otherwise `lastSeenAt` older than 150 s | Same |
| Revoked or rotated token | At once | At once |
| Daemon that predates this | Detected abort: 45 s; a late presence can revive it until the stale sweep | At the abort |

## Work and recovery during grace

- New step claims are pulled with a token check per request. A daemon that is gone makes no new claims. A long-poll claim already open when the Runner dies can still be answered; the abort signal and `stillAuthorized` checks stay as they are, and a step that reaches a dead socket is recovered by the abandoned-step sweeps below. This protocol has no delivery acknowledgment, and this design adds none.
- Recovery keeps today's liveness. Today a drop marks the Runner offline, and the next presence marks it online again. `sweepAbandonedBuildSteps` keeps a progressed step only while its machine is online, and `sweepAbandonedChiefSteps` releases only when the machine is offline. Both read `MachineWakeHub.recoveryOnline(machineId)`: `online` and not (in grace with no presence since the drop). A Runner that dropped and sent nothing counts as offline at once, as today; one that dropped but still posts presence counts as online, as today.
- One deliberate change: when the grace expires the Runner is offline, and its later presence on the old id does not revive it. Today presence alone kept it online until `lastSeenAt` went stale. So a claim whose step heartbeat has also been silent for 120 s, on a Runner whose stream stays down more than 45 s, is released at the first sweep after the grace expires; today it stays claimed for as long as presence keeps arriving. A running step keeps its own heartbeat fresh, so this releases only steps that have stopped reporting.
- After a server restart the hub has no grace, so recovery reads plain `online` and the stale sweep is the fallback, as today.
- Routing reads (`targetUnavailable`, `fallbackMachineId`, `platformFallbackMachineId`, `namedMachineForStart`, `step-queue`, Coordinator home) see the Runner as online during grace. An unpinned task routed to it can wait up to 45 s more before fallback. Pinned and default-Runner tasks wait for the Runner or a person's reroute, as #4596 decided; grace does not change that. `runner-offline` notices still wait 2 min after `lastSeenAt`.
- Pushed commands (branch sync, computer calls) check the live connection, which grace does not fake: during grace `pushSync` and `pushComputer` find no current connection and fail at once, so `branch-sync` returns 409 as it does today for an offline Runner.
- Existing limitation, not fixed here: `pushSync` returns true when the event is queued, and the stream route swallows a failed write. A sync queued just before a drop can stay `pending` or `running` with no timeout. Grace neither causes nor fixes this; it gets its own issue.

## Security boundary

- `online` grants nothing. Every machine endpoint authenticates the bearer token against `tokenHash` (`findMachineByToken`) on each request, and long-poll routes recheck it after each wait.
- Revoke, re-enroll and enrollment authorization keep marking the Runner offline at once, and now also cancel its grace, so a revoked or rotated credential is never shown online longer than today.
- Goodbye derives the machine only from `me(c)`, the current bearer token. It accepts no machine id, uses the `executeMachineCommand` pattern, and revalidates the token after reading the body, before any change. It can only mark the caller's own machine offline, and only for a connection id that machine holds. Presence admission uses the same rule: the id is looked up under the caller's own machine.
- The grace length is a server constant; no request sets or extends it.
- Not a goal: a stolen token that is still valid is indistinguishable from the real daemon. It can post presence, open streams and say goodbye for its own machine, as it can today. Connection ids keep a replaced daemon from changing the current connection; they do not defend against the holder of the active token. Revocation is the remedy.
- `routes-machine.ts`, `services/machine*.ts` and `apps/daemon/src/machine-client.ts` are security surfaces. The code PR records `/security-review` against its exact head before it leaves draft.

## Tests

Server, Vitest with fake timers, through the HTTP routes. Each is a new behavior; existing revocation tests in `machine-revoke.test.ts` stay as they are.

1. Abort of the current stream: online at 44.9 s, offline at 45 s, one offline event.
2. A new stream within 45 s keeps it online with no event. A new stream after expiry marks it online at once and refreshes `lastSeenAt`.
3. Presence on the grace id at 30 s refreshes `lastSeenAt` and does not cancel the grace: offline at 45 s; presence on the same id at 60 s writes nothing and it stays offline; a new stream then marks it online.
4. Replacement: stream A, then stream B; A's late abort, goodbye(A) and presence(A) change nothing and B stays online. Then goodbye(B), then presence(A): stays offline.
5. Rotation: re-enroll while stream A is open, the new daemon opens stream B and posts presence; then A's ping finds its old token invalid. The machine stays online.
6. Goodbye for the current connection and for a pending grace marks offline at once; goodbye with an unknown id returns `applied: false`. Goodbye(A) after expiry does nothing. Presence with `null` after goodbye leaves it offline.
7. Goodbye is rejected with no token, a wrong token, a revoked token and a rotated token. Token A with machine B's connection id, in the same team and in another team, leaves B's state, grace and stream untouched; the same for presence with B's id.
8. Revoke during grace: offline at once, and the old timer firing later changes nothing.
9. Two machines' graces are independent.
10. A stale `lastSeenAt` makes the sweep mark offline during grace with one event, and the timer then does nothing.
11. Build and Coordinator steps with a 119 s old heartbeat when the stream drops: with no presence after the drop they are released at the same sweep as on the baseline; with presence 1 s after the drop, on the grace id or with no `connectionId` field, they are kept, as on the baseline; after expiry with no new stream and a heartbeat older than 120 s they are released.
12. Restart: a new server with the machine online in the database. Presence with a pre-restart id writes nothing; a new stream marks it online; with no stream it turns offline only after 150 s without presence.
13. Presence without a `connectionId` field keeps today's behavior, including marking an offline Runner online.
14. During grace, branch sync returns 409 and computer calls fail.

Daemon, Vitest: presence sends `null` before `hello` and the last id after it; `stop()` waits for `presenceReporter.close()` before goodbye and sends the last id; a goodbye that times out after 2 s or fails does not block shutdown; a daemon that received no `hello` sends no goodbye.

Live on omarchy, on the deployed server, with a read-only watcher on `machine.online` and the server's abort log:

- Kill only the daemon's stream socket, chosen by its local port, with `ss -K`. The Runner stays online and reconnects.
- Stop the daemon. Offline within 2 s.
- `kill -STOP` the daemon for 200 s. It turns offline when `lastSeenAt` passes 150 s, not at 45 s. After `kill -CONT` it is online again, through presence on the still-current connection or a new stream; record which.
- Enroll a throwaway Runner, cut its stream, revoke it during grace. Offline at once and its token is refused. Remove it afterwards.
- One hour of normal load on the baseline and one hour with the change, measured the same way: stream drops, reconnect durations and visible offline transitions. Report drops masked out of drops observed, and the detection delay of each real outage.

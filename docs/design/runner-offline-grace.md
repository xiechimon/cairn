# Runner offline grace period

Tracking: #4596. Status: proposed, awaiting design review. Baseline `origin/main` at `50827425b`.

## Problem

A Runner turns offline the moment its push channel (`GET /api/machine/stream`) drops: `stream.onAbort` in `apps/server/src/routes-machine.ts` calls `markOffline`. The daemon reconnects with backoff (1 s doubling to `CLAIM_BACKOFF_CAP_MS` = 30 s), so a busy host flickers offline and back. On omarchy on 2026-11-14 the channel dropped 24 times; every reconnect took 15 to 31 s. While a flicker lasts, the composer tells the owner to connect a Runner (#4758), routing that prefers an online machine skips it, and a `machine_presence` offline event reaches every open page.

## Design

1. When the current push channel of an authorized Runner drops, the server does not mark it offline. It starts a grace timer of `MACHINE_OFFLINE_GRACE_MS` = 45 s (three stream pings) for that machine, in memory.
2. The grace ends as online, with no event published, when the same machine opens a new push channel or posts presence with a valid token.
3. When the timer fires, the server calls `markOffline` as today.
4. These end the grace at once and mark the Runner offline: the daemon's goodbye (new, below), token revocation, re-enrollment of the same machine, and the stream's own ping loop finding the token no longer valid.
5. Goodbye: on `stop()`, before aborting its streams, the daemon sends `POST /api/machine/offline`, authenticated with its machine token, with a 2 s timeout. The server marks that machine offline and cancels its timer. A daemon that predates this goes through the grace period instead.
6. A timer starts only when the stream that dropped is still the machine's current stream in `MachineWakeHub`. Today a replaced stream's late abort can mark a freshly reconnected machine offline; this design closes that race.
7. The timer is not persisted. After a server restart, `sweepStaleMachines` (150 s since `lastSeenAt`) stays the backstop, as today.

A daemon restart is a goodbye followed by a new stream about 20 s later, so it still shows offline for that time. That is accurate: the process was down.

## Every path that reads or writes `machine.online`

| Path | Today | With grace |
|---|---|---|
| Stream abort (`routes-machine.ts`) | Offline now | Grace timer if it is the current stream; else nothing |
| New stream for the machine | Not a presence write | Cancels the timer |
| `markPresence` | Online, event if it was offline | Also cancels the timer |
| Goodbye `POST /api/machine/offline` (new) | None | Offline now, cancels the timer |
| `revokeMachineToken`, `enrollMachine` (same key), `authorizeEnrollmentMachine` | Offline now | Offline now, cancels the timer, so it cannot flip back |
| Ping loop finds the token invalid | Releases the stream, which then aborts | Offline now, no grace |
| `sweepStaleMachines` (scheduler, 15 s tick) | Offline after 150 s without presence | Unchanged backstop |
| Routing reads: `targetUnavailable`, `fallbackMachineId`, `platformFallbackMachineId`, `namedMachineForStart`, `step-queue`, `runner-offline` alternative, Coordinator home | Skip an offline machine | During grace, treat the Runner as online for at most 45 s |
| `sweepAbandonedBuildSteps` (120 s of no activity) | Releases a claimed step unless the machine is online and the step progressed | Same; 45 s < 120 s, so a step on a dead Runner is released no later than today |
| `sweepAbandonedChiefSteps` (120 s) | Same rule for Coordinator steps | Same |
| `sweepOfflineRunners` notice | 2 min after `lastSeenAt` | Unchanged |
| `branch-sync` | 409 if offline | During grace, `pushSync` finds no stream and the sync fails with `machine stream disconnected before pickup` |
| Web `machine_presence` | Offline then online events per flicker | One offline event, only after the grace ends |

## Dispatch and queued work during grace

Work is pulled, never pushed. A daemon receives a step only from `POST /api/machine/tasks/claim` with a valid token. A Runner that is gone makes no claims, so nothing is handed to it during grace. A pending step routed to it waits at most 45 s longer before routing and the notices see it offline. Claimed steps are released by the abandoned-step sweeps on heartbeat age, which the grace does not lengthen. A branch sync fails fast because it checks the live stream. Nothing waits without a bound: grace is at most 45 s, and the 150 s presence sweep still applies after a server restart.

## Security boundary

- `online` grants nothing. Every machine endpoint authenticates the bearer token against `tokenHash` (`findMachineByToken`) on each request. A revoked token is refused on its next call whatever the flag says.
- Revocation, re-enrollment and an invalid token in the ping loop mark the Runner offline at once and cancel its timer, so a stolen or revoked credential is never shown online longer than today.
- Only a request with the machine's valid token can end a grace as online. The grace length is a server constant; the daemon cannot set or extend it.
- The goodbye endpoint can only mark the caller's own machine offline.
- `routes-machine.ts` and `services/machine*.ts` are security surfaces; the code PR records `/security-review` before it leaves draft.

## Tests

Server tests in Vitest, each red on the baseline:

1. A stream drop keeps the Runner online at 44 s and offline at 45 s, with one offline event.
2. A new stream or a presence post within 45 s keeps it online and publishes no offline event.
3. A replaced stream's late abort starts no timer.
4. Goodbye marks it offline at once.
5. Revoke, and re-enrollment, during grace mark it offline at once, and the old timer does not change it later.
6. A revoked token's stream and claim are refused during grace.
7. A claimed step on a Runner that never returns is released by the abandoned sweep no later than today.

Daemon test: `stop()` sends goodbye before it aborts the stream, and a failed goodbye does not block shutdown.

Live on omarchy, on the deployed server, with a read-only watcher on `machine.online`:

- Drop the daemon's TCP connection to the server with `ss -K` while the process keeps running. The Runner stays online and reconnects.
- Stop the daemon. It is offline within a second.
- Freeze it with `kill -STOP` for 60 s. It turns offline at 45 s, then online after `kill -CONT`.
- Revoke a test Runner during grace. It turns offline at once and its token is refused.
- Leave omarchy under its normal load (load average above 40 is common) for an hour and count offline flips. The baseline is 24 drops on 2026-11-14.

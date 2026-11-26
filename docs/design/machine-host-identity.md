# Machine host identity

Status: accepted 2026-11-21. Adds `machine.hostKey`, `machine.retiredAt`, `hostKey` on the machine enroll/presence wire, and the `machine-retired` step queue reason.

## Problem

A Runner that restarts from the same computer can come back as a second machine row with a new id. Two enrollment paths do it:

- `authorizeEnrollmentMachine` (`apps/server/src/services/machines.ts`) reuses an existing row only when the reported name equals the server's own hostname; every other enrollment inserts a new row.
- `enrollMachine` reuses a row only through the api key that enrolled it, so a rotated or re-issued key also inserts a new row.

Every decision that pins work to a Runner stores that machine id: the routing rule's home machine, the task's route override, and the machine id of the steps that already ran (`step.machineId`, read back as the resume affinity of the next step). None of those are rewritten when a new row appears, so after the restart the pinned step waits for an id no machine can authenticate as. Measured on the demo DB on 2026-11-21: a local merge step stayed pending forever after the Runner re-registered; pointing the task's old machine row at the new one by hand released it, and the queue showed no reason at all (`blocked.kind === 'machine-offline'` renders as "processing" in `apps/web/src/api/mappers.ts` when the pinned row is gone).

## Decision

1. **Host identity key.** The Runner derives a restart-stable key for its host and runner home and reports it as `hostKey` (64 hex chars, sha256):
   - macOS: `IOPlatformUUID` from `ioreg`; Linux: `/etc/machine-id`, then `/var/lib/dbus/machine-id`.
   - Hash input: `cairn-host-v1`, that hardware id, the absolute runner home path. The hostname is not part of the key, so renaming the machine does not lose its identity.
   - A host without a hardware id reports no key and never inherits a row. A fallback over hostname/CPU/memory was rejected: all of those inputs are served back in `machine.capabilities` and `machineRecord`, so such a key would be computable by anyone who can read the machine list — a derivable secret is worse than no key.
   - The key is stored in `machine.json` on first use so a later hardware probe failure cannot change it.
   - It is never returned by any HTTP response, never logged, and never written into `machine.capabilities` (that object is served to the web).
2. **Inheritance on enroll.** Both enrollment paths look up `(teamId, hostKey)` first. On a match the existing row is kept and updated (rotated token, name, api key id, latest cli version, capabilities, `retiredAt = null`), its previous stream is revoked, and the same `machineId` is returned. A known host therefore keeps one identity across daemon restarts, `machine.json` loss, desktop relaunches (the desktop re-enrolls on every start) and api-key rotation.
3. **Backfill on presence.** A machine reporting presence with a `hostKey` sets it on its own row when the row has none. `markPresence` never reassigns a key that another row in the team already holds; it ignores the report instead, so a second row cannot take over an identity through presence.
4. **Retirement.** Revoking a machine's token sets `retiredAt`; enrolling again from the same host clears it. A machine "can never return" when its row is gone or `retiredAt` is set.
5. **Pins to a machine that can never return.** `liveMachineId` (`machine-routing.ts`) answers null for such an id and callers decide:
   - Resume affinity (`priorSessionOf`): the pin is dropped. The step stays placeable and the daemon starts a fresh session with its existing "the session lived on another Runner" note (`resumeMissNote`).
   - Home machine (routing rule, task route override, coordinator rule): dropped for a hosted-repo project, so the step falls back to the team default / sole machine. Kept for a local-repo project, whose checkout exists only on that machine; the queue then reports `machine-retired` naming it.
6. **The queue names the machine and the reason.** `stepQueueProjector` reports `blocked.kind = 'machine-retired'` with `waitingFor` set to the retired machine, the web renders a label saying the machine was deleted or revoked and the step is not reassigned (with the re-register and work-routing pointers), and `sweepUnplaceableSteps` raises its notification with the machine name instead of staying silent.

## Every place that stores a machine id

| Holder | Meaning after this change |
|---|---|
| `machine.id` | Identity row; inherited on re-registration, so all ids below stay valid |
| `routing_rule.machineId` | Home machine of a route: resolved through `liveMachineId` |
| `todo.routeOverride.machineId` | Per-task pin written at build start: same resolution, through `routeProfile` |
| `team.defaultMachineId` | Fallback: cleared by revoke and delete (unchanged) |
| `step.machineId` | Who ran it (breadcrumb) plus the resume affinity of the next step: affinity dropped when the id can never return |
| `step_route.machineId` | Route audit, history only |
| `computer.machineId`, `phone.machineId`, `computer_call.machineId` | FK with cascade; they follow the inherited row |
| `schedule` | No machine column; a scheduled build picks its machine at claim time |
| daemon worktrees, session files, journal | Local to the runner home, keyed by conversation and step, never by machine id |

## Hijack guards

- Adoption requires the exact `hostKey` of an existing row in the same team. The key is a hash of a hardware id plus the runner home path; it is not exposed by any endpoint, so another host cannot present it.
- Both enrollment paths already require authorization to act as a machine in the team (an api key with `machineAccess`, or an owner-approved browser confirm). Adoption grants no new authority: the actor could already claim unpinned work as a fresh machine.
- The stricter existing rules are unchanged and made name-independent: an api-key enrollment whose `hostKey` matches a `kind: 'local'` row with no `apiKeyId` is refused (`403`) whatever name it picks; a browser-confirm adoption of a local row still needs owner approval. The api-key adoption path never writes `kind` (a caller cannot mint `kind: 'local'` by naming itself the server host), and the browser path clears `apiKeyId` so a previously bound key keeps no `byKey` hook into the row. No actor can name the row it wants to take over.
- A takeover revokes the previous stream of the same row. One host runs one daemon per runner home (`supervisor.ts` refuses a second one), so a same-key takeover means the previous daemon is gone.
- Presence can only backfill the reporting row's own empty key. `(teamId, hostKey)` lookup-then-write needs no unique constraint here because the server is a single process writing synchronously; a second server on one DB is out of scope.

## Existing rows

Rows created before this change have `hostKey = null` and are not matched by hardware or hostname: a heuristic there could hand one host's pinned steps and local checkout to another identical machine. Their owner removes the stale row (delete already clears the routing rule and the team default), and the pin rules above release the resume affinity of steps that point at it. The next enrollment of that host writes a `hostKey`, so the duplicate cannot happen again.

## Failure behavior

- A Runner that cannot read its hardware id enrolls without a `hostKey`: it keeps today's identity churn (a lost `machine.json` means a new row), and the release rules above keep its stale row from pinning work forever once the owner removes it.
- A Runner whose runner home moves is a new machine, as the key says. Its old steps keep waiting with the `machine-retired`/pin rules above.
- An older daemon (no `hostKey` in the body) keeps today's behavior; the fields are optional on the wire.
- A refused or unanswered enrollment (401, 403, 409, 429, 5xx, unreachable server, expired or already-claimed approval) never ends the Runner process: a supervisor that restarts on failure would turn the refusal into a loop. The Runner retries in process, doubling up to 60 s so one waiting Runner stays inside the enrollment start limit it shares with other callers on the same address, and logs a cause once until it changes.
- A stale `kind: 'local'` row (another computer's `hostKey`) refuses the server host's own Runner with `this enrollment does not prove it is the local host runner`. Recovery is deleting that offline Runner on the Runners page; the next retry is accepted and, once approved, creates the new local row. A caller that is not on the loopback address gets a different refusal that never suggests deleting a row. Not covered: a local row revoked through the API is hidden from the Runners page, so only `DELETE /api/machines/:id` clears it.

## Tests

- `apps/server/test/machine-host-identity.test.ts`:
  - Red: a machine that runs a plan step, then re-enrolls with the same `hostKey`, gets the same `machineId` and can claim the next (pinned) step. On the old code the second enrollment returns a new id and the pinned step stays pending for both tokens.
  - A different `hostKey` creates a second row and cannot claim work pinned to the first.
  - Presence backfills an empty `hostKey` and refuses to steal one held by another row.
  - Revoking a machine releases the resume affinity of the next step: another machine claims it, and the claim still carries `priorMachineId` naming the retired machine so the daemon writes the "session lived on another Runner" note. Red on the old code (no other machine could claim).
  - A deleted machine id in the resume affinity does not block a claim.
  - A retired machine that is the home of a local-repo task reports `machine-retired` with its name; a hosted-repo task of the same machine is placed on the fallback machine.
- `packages/shared/src/node/host-identity.test.ts`: the key is stable given a hardware id, changes with the runner home, and is null when no hardware id can be read.

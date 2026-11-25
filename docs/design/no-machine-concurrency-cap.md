# No per-computer concurrency cap

mon X, 2026-11-19: a computer runs as many tasks at once as are ready for it. There is no per-computer cap, no recommendation derived from hardware and no "computer is full" queue reason.

## Scenarios

| When you | Before | After |
|---|---|---|
| Start three tasks on your Mac | The third waited for "8/8 running" or for the recommended cap (often 2–4) | All three start on the next claim poll |
| Open the tray while tasks run | Each queued task said the computer was full, and the tooltip said "at most N at once" | Tasks waiting on a computer say only that they are queued; the tooltip lists memory, load and disk |
| Ask the Coordinator to list computers | It reported running/max | It reports what runs |

## What stays

- The project cap (`project.maxConcurrent`, unset by default) still holds a project's steps. It is a per-project choice, not a property of the computer.
- An orb Runner still limits how many sandboxes it starts at once (`resolveOrbCap`: `CAIRN_ORB_MAX` or the CPU-count default). It sends that number as `maxWorkers` on claim and the server still honours `maxWorkers`, so the limit stays on the computer that owns the sandboxes.
- Strain never holds a task; it only moves pool work to a calm Runner when one exists (`runner-auto-dispatch.md`).

## Removed

- Columns `machine.maxConcurrent` and `machine.maxConcurrentOverridden` (migration drops both), the startup backfill `machine-concurrency-backfill`, and `recommendMachineConcurrency`.
- `MachineRecord.maxConcurrent`, `maxConcurrentOverridden`, `recommendedConcurrent`, `concurrencyRange` and `concurrencySource`, and `maxConcurrent` in the machine PATCH body.
- The `capacity` reason in `TodoRecord.waitingOn.on` and in `MachineRecord.queued[].reason`.
- `running` and `capacity` in a queued step's `waitingFor` (steps and Coordinator turns); the queue label names only the computer.
- The host Runner's own cap: `resolveLocalCap`, `CAIRN_DAEMON_MAX_CONCURRENT`, and the `/me` refresh that read `maxConcurrent`. A host Runner claims whenever it is ready.

## Claim paths

| Path | Gate after this change |
|---|---|
| Worker step (`tryClaim`) | `maxWorkers` when the Runner sends it, then project cap, capabilities, quota |
| Coordinator turn (`claimChiefTurn`) | `maxWorkers` when the Runner sends it |
| Host Runner loop | none of its own; waits only while not ready |
| Orb Runner loop | its sandbox cap |

## Failure behaviour

- A Runner from before this change reads no `maxConcurrent` from `/me`, falls back to one step at a time and sends `maxWorkers: 1`. It runs serially until it is updated; the desktop app ships Runner and server together, so only separately installed Runners see this.
- Many tasks on a small computer: they all start. The tray shows the strain; the owner stops tasks if needed.

## Tests

- Four ready tasks on one computer: four claims succeed in a row.
- `maxWorkers: 2` from the Runner: the third claim returns nothing, for worker steps and Coordinator turns.
- The project cap still holds the second step of a capped project.
- A host Runner with three steps ready starts all three without waiting for the first.
- The migration drops both columns and keeps every machine row.

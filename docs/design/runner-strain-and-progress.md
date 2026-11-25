# Runner strain gate, last progress and queue reasons

Backend for the tray's run overview (prototype approved by mon X, 2026-11-18): per computer, what runs, what waits and why, memory and load, and tasks that stopped making progress. The tray UI itself lands after the native tray rework.

## Scenarios

- A Mac with 16 GB runs three tasks and memory runs out. The tray heading turns amber and names the strain. The fourth task still starts: strain never holds a task (mon X, 2026-11-19, after a high load average made every second task queue behind the first).
- A Mac sits at load 12 on 8 cores with the fans quiet and the cpu mostly idle. The tray heading reads 3%, not 100%: the percent is CPU utilization and memory pressure, never the load average (mon X, 2026-11-21).
- A task's agent sits in one tool call or retry loop for twenty minutes. Today nothing distinguishes it from a healthy run: the 30-second heartbeat only says the process is alive. After: the step carries the time of its last real progress, and the tray marks the task stuck after 15 minutes without progress.

## Strain

`machineStrain(hardware)` in `packages/shared` returns the reasons a computer is strained, from the hardware the Runner reports every 30 seconds:

| Reason | Condition |
|---|---|
| `memory` | memory pressure at or above 90% (available below 10% of total) |
| `cpu` | CPU utilization at or above 90% |
| `disk` | free disk below 5 GB |

The load average is reported but decides nothing: on macOS it counts threads blocked on IO, so a Mac with idle cores routinely sits above its core count, and the earlier rule marked it strained for hours after a single busy spell. `cpuUtilization` is the busy share of the `os.cpus()` tick delta between two reports, so it measures work the computer actually did in that window. `memoryPressure` on macOS comes from `kern.memorystatus_level` (the share of memory the kernel considers available, the figure behind Activity Monitor's memory pressure); on Linux it is the share `MemAvailable` does not cover, and `os.freemem()` there reads `MemAvailable`. If the sysctl read fails the Runner reports no macOS pressure and keeps `os.freemem()`, which counts only completely free pages and sits near zero on a healthy Mac.

A Runner that predates these fields reports neither, and is never strained on CPU or pressure; its available-memory share still strains memory, so an old Runner is never presented as calmer than it is.

## No claim gate

Strain never holds a task. Since 2026-11-25 it redirects one: when the preferred Runner is strained and another eligible Runner is not, the next pool task goes to the calm one (`runner-auto-dispatch.md`); with no calm alternative the strained Runner claims it as before. Computers have no concurrency cap (`no-machine-concurrency-cap.md`). An earlier gate held a second task while a computer was strained and busy; it was removed on 2026-11-19 because on a busy Mac the 5-minute load stays above the core count for hours, so tasks ran one at a time with a queue label that gave no reason.

## Queue reasons

`TodoRecord.waitingOn.on` is `machine` (no runnable computer) or `quota` (a quota hold).

`MachineRecord` gains `strain` (the reasons above, empty when fine) and `queued`, the tasks whose next step waits for this computer, each with its reason (`quota` with `retryAt`, or `waiting` for a step that will be claimed on the next poll).

## Last progress

`step.lastProgressAt` (new nullable column) is written when the Runner reports a tool call, a transcript row, a text or thinking delta, or activity in the `thinking`, `responding`, `tool` or `compacting` phase. `awaiting_model`, `retrying`, `preparing` and `starting` are not progress. Writes are throttled to one per step per 30 seconds. A step with no progress yet counts from `claimedAt`.

`TodoRecord.lastProgressAt` is the latest value over the latest build's claimed steps, absent when none is claimed; each `MachineRecord.running` entry carries the same for its task. `STALL_AFTER_MS` (15 minutes) and `isStalled` live in `packages/shared` so the tray and any later surface agree.

## Live updates

`markPresence` publishes `machine_presence` when a computer's strain reasons change, so a subscribed client refetches `/machines` when a warning should appear or clear. Memory figures between those changes are read on the client's own refetch.

## Failure behaviour

- Hardware missing or unparsable: not strained.
- Runner offline: hardware is stale but the computer claims nothing anyway.
- Migration adds a nullable column; old rows read as no progress yet.

## Tests

One per path: memory, CPU and disk strain each still let a busy computer start the next task, with the strain reported on the computer; progress reports set `lastProgressAt` and non-progress activity does not; the throttle skips a second write within 30 seconds; a strain change publishes `machine_presence` and an unchanged report does not; the macOS memory probe parses the sysctl value and falls back on failure; CPU utilization is the busy share of the tick delta, and a Runner reporting load 12 on idle cores with 63% memory pressure is not strained.

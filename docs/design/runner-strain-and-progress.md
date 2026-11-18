# Runner strain gate, last progress and queue reasons

Backend for the tray's run overview (prototype approved by mon X, 2026-11-18): per computer, what runs, what waits and why, memory and load, and tasks that stopped making progress. The tray UI itself lands after the native tray rework.

## Scenarios

- A Mac with 16 GB runs three tasks and memory runs out. Today the claim gate only counts slots, so a fourth task starts and everything swaps. After: the fourth task waits, its queue reason says the computer is strained, and it starts on its own once memory frees.
- A task's agent sits in one tool call or retry loop for twenty minutes. Today nothing distinguishes it from a healthy run: the 30-second heartbeat only says the process is alive. After: the step carries the time of its last real progress, and the tray marks the task stuck after 15 minutes without progress.
- A task waits because its computer is already running as many tasks as it allows. Today the task says nothing (`waitingOn` only knows `machine` and `quota`). After: it says `capacity`.

## Strain

`machineStrain(hardware)` in `packages/shared` returns the reasons a computer is strained, from the hardware the Runner reports every 30 seconds:

| Reason | Condition |
|---|---|
| `memory` | available memory below 10% of total |
| `load` | 5-minute load average above the core count |
| `disk` | free disk below 5 GB |

The Runner reports `loadAvg5` beside `loadAvg1` (optional on the wire; an old Runner omits it and is never load-strained). On macOS available memory comes from `kern.memorystatus_level` (the share of memory the kernel considers available, the figure behind Activity Monitor's memory pressure); `os.freemem()` there counts only completely free pages and sits near zero on a healthy Mac. If the sysctl read fails the Runner falls back to `os.freemem()`. Linux keeps `os.freemem()`, which reads `MemAvailable`.

## Claim gate

A strained computer claims no new task step while it runs any step. When it runs nothing it may claim one, so a computer whose memory another app holds still makes progress. Coordinator turns are not gated: a held turn would stall the conversation, and a turn is far lighter than a task. Unknown hardware is never strained.

## Queue reasons

`TodoRecord.waitingOn.on` gains `capacity` (the computer that would run the step is online and eligible but at `maxConcurrent`) and `strained` (it is under the cap but strained and busy). Order of checks: quota hold, no runnable computer (`machine`), `capacity`, `strained`.

`MachineRecord` gains `strain` (the reasons above, empty when fine) and `queued`, the tasks whose next step waits for this computer, each with its reason (`capacity`, `strained`, `quota` with `retryAt`, or `waiting` for a step that will be claimed on the next poll).

## Last progress

`step.lastProgressAt` (new nullable column) is written when the Runner reports a tool call, a transcript row, a text or thinking delta, or activity in the `thinking`, `responding`, `tool` or `compacting` phase. `awaiting_model`, `retrying`, `preparing` and `starting` are not progress. Writes are throttled to one per step per 30 seconds. A step with no progress yet counts from `claimedAt`.

`TodoRecord.lastProgressAt` is the latest value over the latest build's claimed steps, absent when none is claimed; each `MachineRecord.running` entry carries the same for its task. `STALL_AFTER_MS` (15 minutes) and `isStalled` live in `packages/shared` so the tray and any later surface agree.

## Live updates

`markPresence` publishes `machine_presence` when a computer's strain reasons change, so a subscribed client refetches `/machines` when a warning should appear or clear. Memory figures between those changes are read on the client's own refetch.

## Failure behaviour

- Hardware missing or unparsable: not strained, no gate.
- Runner offline: hardware is stale but the computer claims nothing anyway.
- Strain persists while nothing runs: one task still starts.
- Migration adds a nullable column; old rows read as no progress yet.

## Tests

One per path: memory, load and disk strain each hold a second task and the queue reason reads `strained`; a strained idle computer still claims one; a Coordinator turn claims while strained; a full computer reads `capacity`; progress reports set `lastProgressAt` and non-progress activity does not; the throttle skips a second write within 30 seconds; a strain change publishes `machine_presence` and an unchanged report does not; the macOS memory probe parses the sysctl value and falls back on failure.

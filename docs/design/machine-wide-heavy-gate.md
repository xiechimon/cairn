# Machine-wide heavy-work gate

Every command that can consume more than a quarter of the machine takes one of a small number of
machine-wide slots, and each slot caps what its holder may spend. The gate lives in
`scripts/heavy-slots.mjs`; `docs/ops/worktrees-and-ports.md` states the operator rules.

## What the machine's state is

One directory (`CAIRN_HEAVY_SLOTS_DIR`, else the Darwin user temp directory or `os.tmpdir()`) holds:

| File | Meaning |
|---|---|
| `slot-<n>.lock` | the lease: JSON `{pid, cwd, namespace, probe, token, count}`. Written only while holding `slot-<n>.lock.guard`'s kernel flock. |
| `slot-<n>.lock.guard` | a permanent inode; every claimant flocks it through Python 3 before touching the lock. Never unlinked. |
| `queue-<ts>-<pid>-<token>` | a waiting ticket, oldest name first. |
| `live-stack/slot-<n>.lock` | the same protocol for one verify-cairn live stack (`CAIRN_LIVE_STACK_SLOTS`, default 1). |

Capacity is `max(1, floor(cores/4))`, derived from the machine's core count at admission time; no
setting overrides it. The probe socket is a unix listener bound at `probePath(token)`, which keeps
the path under 100 bytes: connecting to it proves the holder is alive even when its pid was
recycled.

## Transitions

`free → queued`: `acquireSlot` writes its ticket. `queued → leased`: the process is first in
ticket order, a slot at or below its capacity is free, and CPU is under the saturation limit.
`leased → free`: the holder exits, releases, or is killed — the kernel drops the guard flock and
the probe listener; the next claimant reads `probe` unreachable plus a dead pid and reclaims.
`free → light`: a Vitest run over at most four named test files skips the gate, so iteration on
one file never waits behind a full queue. `free → bypassed`: `CAIRN_HEAVY_GATE_BYPASS` is set;
nothing is written. Nothing changes in the directory for either of the last two, so neither can
leave stale state behind.

## Every path that reads or writes the state

| Path | Reads | Writes |
|---|---|---|
| the claim loop | guard flock, lock JSON, probe, ticket list | its own ticket, `slot-<n>.lock` |
| the queue display | ticket list, lock JSON, probe | nothing |
| a descendant of a holder | its own inherited `CAIRN_HEAVY_SLOT`/`_OWNER` and the lock JSON | nothing — it reuses the verified ancestor lease, so a nested tool never queues behind its own parent |
| `holderState` reclaim | lock JSON, probe, pid liveness | removes a dead holder's probe socket and stale ticket |

## Behavior on each failure

- **Holder dies without releasing** (SIGKILL, crash, closed laptop): probe unreachable and pid gone,
  or the metadata is younger than the 2 s partial-write grace. Next claimant reclaims and deletes
  the orphan socket. Test: `kill -9 on the holder frees the slot for the queued process within 5
  seconds`, `simultaneous reclaim of one dead holder: exactly one process inherits the slot`.
- **Two processes race for the last slot**: both take the guard flock in turn; only the one that
  finds the lock absent writes it. Test: `simultaneous grabs for the last slot: exactly one wins,
  every round`.
- **A waiter's ticket cannot use the only free slot** (a ticket written by a run that saw a larger
  capacity, e.g. before a core-count change): it is skipped by the free-slot walk instead of
  head-blocking everyone behind it. Test: `a queued waiter that can never use a free higher slot
  does not head-block the queue`.
- **CPU is saturated** (≥ `CAIRN_CPU_SATURATION_PERCENT`, default 90, sampled from `os.cpus()`
  deltas — macOS load average counts IO waits, so it is never used): a free slot stays unclaimed and
  the waiter logs the measured percentage. A non-waiting probe returns null. After
  `CAIRN_CPU_SATURATION_MAX_WAIT_MS` (default 10 min) it starts anyway and says so, so a runaway
  neighbour cannot block the lane forever. Tests: `a saturated cpu keeps a waiter queued until the
  machine drains`, `a cpu saturation probe refuses a non-waiting admission...`, `a cpu that stays
  saturated past the max wait starts anyway and says so`.
- **Python 3 or its flock is missing**: admission throws instead of granting a slot it cannot
  verify; descriptors opened for the attempt are closed. Test: `kernel helper failures propagate
  and release candidate descriptors`.
- **A slot port is squatted by another checkout**: the port holder's pid, cwd and command are
  reported and the run refuses to test that build. Tests: `foreignPortHolderReport ...`.
- **A holder looks stuck**: every queue line names each slot's lane, pid, command and age, and the
  waiter repeats it every `CAIRN_HEAVY_QUEUE_REPRINT_MS` (default 30 s), so the person or agent
  waiting reads why without inspecting processes. Test: `a waiter names the lane, command and age of
  every holder and repeats while it waits`.
- **A live stack outlives its usefulness**: the stack stops itself after `VERIFY_MAX_AGE_MS`
  (default 45 min, `0` disables) even while something keeps polling it, which is the case the idle
  timeout cannot catch. `launch.mjs` prints both limits when it becomes ready.
- **CI**: every workflow sets `CAIRN_HEAVY_GATE_BYPASS=1` once, so the bypass is one line in the
  log rather than an implicit property of a missing directory. Tests: `only the explicit bypass
  flag skips admission, and it names itself in the log`, `CI takes a slot unless it sets the
  bypass flag`.

## Who takes a slot, and what it caps

`pnpm prepush`, `pnpm test:changed`, every Vitest project config (`maxWorkers`, except a run over
at most four named files), Playwright
(`workers` and the leased port), the verify-cairn live stack, and the desktop
`build`/`start`/`dist:mac`/`dist:linux` scripts. A lease gives its holder
`max(1, floor(cores/capacity))` workers, so two holders on an 8-core Mac run four workers each
instead of seven and seven. Tests: `an admitted run ... caps its holder to the cores its slot owns`,
`three runs at capacity 1 never overlap`, `three prepush runs in three checkouts at capacity 1
serialize`, `a desktop pack waits for a slot before it builds anything`, `a run over a few named
test files is light and never waits behind heavy work`.

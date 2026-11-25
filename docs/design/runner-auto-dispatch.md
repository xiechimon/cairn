# Every Runner takes work; load decides where the next task goes

mon X, 2026-11-25: the per-Runner "Enable/Disable auto-dispatch" and "Concurrency: N" menu items are removed. Every Runner always accepts work, and the computer's live load decides whether the next task stays on the preferred Runner or overflows to another one. Supersedes the `autoDispatch` and `maxConcurrency` columns added by migration `0254_machine_failover_overflow`.

## Newcomer

Someone who installed Cairn today with one Mac sees nothing new: the Runners menu has two fewer items ("Set as default" and "Delete" remain). With two computers, a task they start goes to the default Runner unless that computer is under load, in which case it starts on the other one. They configure nothing; no account, key or payment is involved.

## Scenarios

| When you | Before | After |
|---|---|---|
| Start a task while your default Mac is pinned at 95% CPU and the mini is idle | It ran on the Mac (no cap set) | It starts on the mini; the step records `routedReason: busy` |
| Start a task when your only Runner is under load | It ran there | It still runs there: load moves work, it never holds it (mon X, 2026-11-19) |
| Your MacBook was set to "Manual only" and the default mini goes offline | Tasks waited for the mini | After the 15 s grace the MacBook takes them |
| Your default Mac is calm | It ran there | It runs there |
| Both computers are under load | Default Runner | Default Runner |

## The load signal

The Runner already reports `capabilities.hardware` with every presence report (every 30 s). A Runner is **under load** when `machineStrain(hardware)` (`packages/shared/src/records/machine-capabilities.ts`) returns any reason:

| Reason | Condition |
|---|---|
| `cpu` | CPU utilization ≥ 90% over the last report window |
| `memory` | memory pressure ≥ 90% |
| `disk` | free disk < 5 GB |

The brief suggested "1-minute load average ≥ core count". That rule is not used: on macOS the load average counts threads blocked on IO, so an idle Mac sits at load 12 on 8 cores for hours, and the owner already rejected it on 2026-11-21 (`runner-strain-and-progress.md`). Using `machineStrain` keeps one definition: the tray's CPU, memory and disk strain labels and the router agree.

Missing or unparsable hardware (an old Runner, a failed probe): not under load. Stale hardware: a Runner whose last presence is older than `MACHINE_STALE_OFFLINE_MS` is swept offline and is not a candidate at all; an online Runner's hardware is at most one report interval old.

## Routing rule

`resolveWorkerCandidates` and `resolveChiefCandidates` in `apps/server/src/services/machine-routing.ts`:

- Pinned paths (active session, local-path project or local merge, explicit pick, host Antigravity subscription): the pinned Runner claims whenever it is online and eligible. No slot check; load does not hold pinned work.
- Pool path, preferred Runner eligible and online:
  - not under load → preferred claims;
  - under load and at least one other eligible online Runner is not under load → those Runners claim (fewest running first), `failover.reason = 'busy'`;
  - otherwise → preferred claims.
- Pool path, preferred offline past the 15 s grace → every other eligible online Runner may claim, calm ones first then fewest running; `failover.reason = 'offline'`. Under load does not exclude a backup here: an online Runner beats an offline one.
- Offline within grace → wait for the preferred Runner (unchanged).

The claim-side cap (`runnerFull` in `machine-claim.ts`) keeps only `maxWorkers`, the orb Runner's own sandbox cap sent on claim (`no-machine-concurrency-cap.md`).

## State: every reader and writer removed

| Place | What goes |
|---|---|
| `machine.autoDispatch`, `machine.maxConcurrency` (`db/schema.ts`) | Columns dropped by migration `0255_runner_auto_dispatch` |
| `PATCH /api/machines/:id` (`routes-resources.ts`) | Both fields; unknown fields are stripped by the schema, so an old client's PATCH changes nothing |
| `MachineRecord`, `patchMachineBodySchema` (`packages/shared/src/records/machine.ts`) | Both fields |
| `toMachineRecord` (`services/machines.ts`) | Both fields |
| `effectiveMaxConcurrency`, the `autoDispatch !== false` backup filter (`machine-routing.ts`) | Replaced by the rule above |
| `runnerFull` (`machine-claim.ts`) | `maxConcurrency` term |
| Web: `machine-row.tsx` menu items and the "Manual only" / "Limit N" meta, `mappers.ts`, `fixtures/records.ts`, six i18n keys in `en.ts` | Removed |

## Migration

`ALTER TABLE machine DROP COLUMN` for both. Every row is kept; a row that had `autoDispatch = 0` (the owner's MacBook Pro) becomes a normal Runner because the filter no longer exists. A row with a `maxConcurrency` loses it. No backfill, nothing to roll forward.

## Failure behaviour

- Strain flips between reports: routing follows the latest report; at worst one task lands on the busier computer for up to 30 s.
- A burst of tasks before the first load report reflects them: they all land on the preferred Runner, as before this change. Load then moves later tasks. The owner chose this over a hidden per-core soft cap (2026-11-25).
- All Runners under load: work goes to the preferred Runner; nothing waits on load.

## Tests

- A preferred Runner under CPU load overflows the next task to a calm backup (`routedReason: busy`); when the backup is also under load, the preferred Runner takes it.
- A Runner that was "Manual only" before the migration takes failover work after it; the migration keeps every machine row and drops both columns.
- Existing: a sole strained Runner still starts the next task (`machine-concurrency.test.ts`, "machine strain never holds a task").

# ADR 0020 · Machine recommended concurrency: capability-fingerprint formula and override priority

> Status: **Recommended concurrency decided** (user ruling 2026-10-12, construction settled by #1241). Load-based suspension is **not decided**; it is moved out of this implementation, see "Load-based suspension (follow-up ticket)". Supersedes #1108's fixed default of 3 + manual entry (maxConcurrent is no longer decided by the write surface alone). #1108's value domain (1..16), queuing semantics, and the claim gate are unchanged.

## Problem Statement

The machine concurrency cap used to be a manually entered fixed number (column default 3, #1108). It had no relationship to a machine's real capacity: weak machines overloaded, strong machines sat idle.

The user's ruling (#1241 comment, 2026-10-12, binding): the concurrency number is a **recommended value**, not a forced cap. The daemon reports machine capabilities; the server computes a recommended concurrency onto the machine row; it is visible and changeable. If the user has not changed it, the recommended value is used; if the user has changed it, the user's value wins and is persisted. When capability data is missing, fall back to a conservative default and mark it "estimated". **The server must never force a hard cap.**

## Formula

Inputs come from the fingerprint the daemon probes fresh every beat (`machineHardwareSchema`, not cached): core count `cpuCores`, total memory `memoryTotalMb` (MiB). Available memory `memoryAvailableMb`, the 1-minute load, and disk headroom feed only the rationale display, not the formula.

```
recommended = clamp( min(cpuCores, floor(memoryTotalMb / (1024 * MEMORY_GB_PER_SLOT))), 1, 16 )
MEMORY_GB_PER_SLOT = 2
```

- Cores and memory each act as an upper bound: each concurrency slot counts as 2 GiB of total memory. Memory uses the total, not the available: steps in flight consuming available memory must not shrink the recommended value. The recommended value is decided only by the machine's configuration and does not jitter between adjacent beats.
- Lower bound 1: never zero slots (an online machine can always claim one step). Upper bound 16 = the upper edge of #1108's PATCH write domain, consistent with the issue's "floor 1, ceiling 16" wording. The upper bound clamps the recommended value; it is not a second gate on top of the user's value: the user's value itself can only be written within 1..16 (#1108).
- Source labeling: a valid fingerprint (including `memoryTotalMb`) = `measured`; no fingerprint, invalid fingerprint fields, or a fingerprint missing `memoryTotalMb` (old daemons and rows persisted before the upgrade) = `estimate`, with the conservative default `CONSERVATIVE_CONCURRENCY = 3`.

| Fingerprint | Computation | Result |
|---|---|---|
| 32 cores / 64 GiB total memory | min(32, 32) = 32 → clamp 16 | 16 measured |
| 32 cores / 64 GiB total memory, only 0.5 GiB available (steps filling it) | min(32, 32) = 32 → clamp 16 | 16 measured |
| 8 cores / 6 GiB total memory | min(8, 3) = 3 | 3 measured |
| 2 cores / 2 GiB total memory | min(2, 1) = 1 | 1 measured |
| 2 cores / 1.5 GiB total memory | min(2, 0) = 0 → clamp 1 | 1 measured |
| No fingerprint (old daemon / probe failure with no previous beat) | conservative default | 3 estimate |

## Override priority

| State | `maxConcurrentOverridden` | Stored `maxConcurrent` | `concurrencySource` | The number the claim gate reads |
|---|---|---|---|---|
| User wrote (PATCH number) | true | user value, heartbeat does not change it | manual | user value |
| Not overridden, fingerprint present | false | latest-beat recommended value | measured | recommended value |
| Not overridden, no fingerprint | false | conservative default 3 | estimate | 3 |

- PATCH with a number = override and persist. PATCH `null` = clear the override, immediately recompute from the current fingerprint.
- A heartbeat missing `hardware` (one probe failure) keeps the previous beat's fingerprint; it does not downgrade a measured recommendation back to an estimate.
- `recommendedConcurrent` is delivered with the row (also sent when overridden), used by the "restore recommendation" surface and the rationale display.

## Load-based suspension (follow-up ticket, not decided)

Not implemented this round: no code, no new columns, no badges.

- Origin: the #1241 issue body proposed dynamic load shedding on the automatic path (acceptance item 2 and the "dynamic load shedding" entry).
- Ruling: the owner's binding comment (2026-10-12) only fixed "recommendation does not force a hard cap". Suspending new claims equals the server pressing the machine cap to 0, which crosses that ruling, and therefore cannot be implemented on the strength of the issue body alone.
- What the owner must confirm before the follow-up ticket starts: the threshold, hysteresis, whether chief steps are exempt, and whether dynamic load shedding is needed rather than suspension. The candidate wording from the issue body (for reference only, not adopted): enter when 1-minute load > 1.5 × cores or available memory < 512 MiB; exit when load ≤ 1 × cores and available memory ≥ 1 GiB.

## Existing-data migration (0043)

The only user write surface of `maxConcurrent` is PATCH, and the column default is permanently 3 (0031). The migration backfills `maxConcurrentOverridden = 1 WHERE maxConcurrent <> 3`: a non-default value is treated as "the user wrote it and it persisted". Existing rows exactly at 3 cannot be distinguished from the default and are treated as not overridden (they take the recommended value); this trade-off is covered by the owner question under "Open". Test: `apps/server/test/machine-concurrency-backfill.test.ts`.

## Open

- **Awaiting owner ruling**: existing rows exactly at 3 are uniformly treated as not overridden, i.e. a user who explicitly chose 3 will be treated as default and take the recommended value after the upgrade. This is a known trade-off of the backfill criterion, not an omission: non-default values can be judged as user-written, but 3 is indistinguishable from the default. The owner must rule on one of: (a) accept that this slice of existing rows is taken over by the recommended value; (b) keep it — record the source bit on PATCH, but existing rows are not retroactively traceable, so it only takes effect for writes after the upgrade. Until the ruling, the current backfill (`<> 3`) stands.
- Disk headroom (`diskFreeMb`) is already reported and displayed as rationale, but does not enter the formula.

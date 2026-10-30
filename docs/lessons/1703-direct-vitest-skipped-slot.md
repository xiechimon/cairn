---
Category: Direct prepush-vitest runs skipped the machine-wide test queue and overloaded the Mac
Source: PR #1703 (2026-10-25)
Level: 1
Safeguard: scripts/prepush-vitest.mjs acquires a heavy slot and reuses inherited leases; on macOS the slot lock directory comes from `getconf DARWIN_USER_TEMP_DIR`, not `TMPDIR`, unless `CAIRN_HEAVY_SLOTS_DIR` is set (`slotLockDir` in `scripts/heavy-slots.mjs`); scripts/heavy-slots.test.mjs covers direct queueing, nested lease reuse and an overridden TMPDIR; since 2026-10-30
Intercepts: 1
Recurrences: 0
Notes: The direct-run test fails against the original script because vitest starts while the only slot is held; reconciliation preserves the port-occupancy tests added on main and creates the TMPDIR required by the updated sandbox. Recurrence on 2026-10-29: a session set `TMPDIR` without `CAIRN_HEAVY_SLOTS_DIR`, so its runs took slots in a private lock directory beside other lanes' e2e runs; the old formula maps `TMPDIR=/private/tmp/sandbox-override` to a separate directory, `slotLockDir` maps it to the shared one (`docs/verify/2193/heavy-slot-lock-dir.log`). Linux keeps `os.tmpdir()`: omarchy lanes on older branches would otherwise meet in a different directory during the rollout, so a Linux TMPDIR override is still a bypass
---

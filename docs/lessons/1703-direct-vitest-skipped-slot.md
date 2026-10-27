---
Category: Direct prepush-vitest runs skipped the machine-wide test queue and overloaded the Mac
Source: PR #1703 (2026-10-25)
Level: 2
Safeguard: scripts/prepush-vitest.mjs acquires a heavy slot and reuses inherited leases; scripts/heavy-slots.test.mjs covers direct queueing and nested lease reuse
Intercepts: 1
Recurrences: 0
Notes: The direct-run test fails against the original script because vitest starts while the only slot is held; reconciliation preserves the port-occupancy tests added on main and creates the TMPDIR required by the updated sandbox
---

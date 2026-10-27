---
Category: Changing `--check-coverage` in `scripts/e2e-affected.mjs` to reject non-spec paths went unnoticed: nobody saw that verify-cairn's `vp-registry-gate.mjs --check-reach` also feeds probe scripts to it; the probe-reach gate runs only in an advisory CI job, so main stayed red across several commits with nobody intercepting
Source: probe-reach gate red on main (#1651, 2026-10-24)
Level: 2
Safeguard: `vp-registry-gate.mjs --check-reach` now hands only `*.spec.ts` files to e2e-affected; probe scripts are judged by their own drive registration; `docs/verify/1542/reach.test.mjs` enters `scripts/prepush.mjs`'s required checks, pinned by `scripts/prepush.test.mjs`; the rewrite object that swaps the family-table prefix in that test follows #1599's table-structure update
Intercepts: 0
Recurrences: 1
Notes: Negative control: before the fix, `node --test docs/verify/1542/reach.test.mjs` had two red cases (drive-hotkeys.mjs reach probe, discovering new files from the baseline), 9 green after; `prepush.test.mjs` went red before the command was added to the plan
---


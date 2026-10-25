---
Category: Changing `scripts/e2e-affected.mjs` `--check-coverage` to reject non-spec paths broke verify-cairn's `vp-registry-gate.mjs --check-reach`, which fed probe scripts to it, and nobody noticed; the probe-reach gate only runs in an advisory CI job, so main stayed red across several commits with no one blocking it
Source: probe-reach gate red on main (#1651, 2026-10-24)
Level: 2
Safeguard: `vp-registry-gate.mjs --check-reach` hands only `*.spec.ts` files to e2e-affected, and probe scripts are judged by its own drive registration; `docs/verify/1542/reach.test.mjs` is in the required checks of `scripts/prepush.mjs`, pinned by `scripts/prepush.test.mjs`; that test's family-table prefix rewrite object follows the table-structure update from #1599
Intercepts: 0
Recurrences: 1
Notes: negative control: before the fix `node --test docs/verify/1542/reach.test.mjs` had 2 red cases (drive-hotkeys.mjs reachable probe, new file found from the baseline) and all 9 green after; `prepush.test.mjs` went red first when the command was added to the plan
---

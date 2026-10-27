# #1181 — verify-pacman drive-hotkeys / drive-newtask-key migration off the retired search selectors

The fix: `drive-hotkeys.mjs` and `drive-newtask-key.mjs` no longer wait on the retired
`.search-panel` / `.search-input-row` selectors (retired with the #950 / #910 semantic-carrier migration,
zero definitions under `apps/web/src`), and move to the current semantic carriers in the same shape as the #1166 (PR #1179) search probe landing in `drive.mjs`.

This ticket's two parallel lanes (PR #1202 and PR #1205) each completed the full-chain migration; the merge takes
PR #1205's script version, with the differences and trade-offs recorded in the "two-lane differences" section below.

## Migration map (the ticket's 5 lesion spots + the stale assertions blocked by the same root cause in the same files)

| old selector | new carrier |
|---|---|
| `.search-panel` (panel wait x3) | `getByRole('dialog', { name: '搜索' })` |
| `.search-input-row input` (the input box x2) | `getByRole('textbox')` inside the panel scope |
| `button[aria-label="总管"] .kbd-hint` (the ⌘J hint, retired since #1008) | the page-level `[data-slot="tooltip-content"]` + the inner `[data-slot="kbd"]` copy ⌘J (same law as the e2e hotkeys.spec) |

Stale assertions in the same files fixed along the way in `drive-hotkeys.mjs`'s migration (same root cause as the retired selectors; reproduced red on the same stack before the change, see before/hotkeys/run.log):

1. **The ⌘J input-state negative semantics**: since #468, ⌘J is a toggle — pressing ⌘J inside the search box guards that
   "the drawer stays closed" (when a panel is open, ⌘J may only close the face it opened itself), not "zero drawer nodes"
   (the DOM-resident `display:none`). The assertion changes from `count() === 0` to "not visible".
2. **The schedules page C-open criterion**: the old assertion `page.url().includes('/app/schedules')` is constantly true (the URL must be so after goto) — changed to the real criterion "the dialog visible after 8 presses", with enough headroom for the cold stack's first-compile window.
3. **The drawer collapse path**: ADR 0013 D3 ruled that Escape never closes the panel (`onOpenChange` only collapses inner popovers for `escape-key`) — the collapse goes through the ⌘J toggle, same law as the e2e hotkeys.spec (a difference between this version and the #1202 version, see the next section).

The same-named classes in `drive-949-overlays.mjs` / `drive-947-secondary.mjs` are on the retirement-audit list (asserting the rule does not exist) and were not touched.

## Two-lane differences (#1202 already merged / #1205 this version)

| face | #1202 (already on main) | #1205 (this version, effective after the merge) |
|---|---|---|
| the 5 search spots + the kbd-hint migration | same shape | same shape |
| drawer collapse | Esc + an 8s tolerance wait (`.catch` tolerates a non-close — Esc does not actually collapse the window; the timeout swallows it) | the ⌘J toggle collapse (matching ADR 0013 D3's current behavior) |
| the schedules criterion | the dialog visible after 8 presses | the dialog visible (pressUntil) |
| feature map / changelog | not updated | `features/hotkeys.md` + `changelog/2026-10-11-1181.md` updated |

## Rerun recipe

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"  # this repo's node goes through fnm
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-hotkeys.mjs
node .claude/skills/verify-pacman/scripts/drive-newtask-key.mjs
```

Stack: server `:8791` + vite `:5273`, PACMAN_HOME = `.claude/verify-run/home`
(launch wipes it every time = a fresh library).

## Evidence (paired before-red / after-green)

Each lane leaves one paired set, the directory names distinguishing the lanes:

| leg | result | evidence |
|---|---|---|
| before · drive-hotkeys (#1202 lane, run before the migration) | `Meta+k never opened .search-panel` crashes at pressUntil; the two kbd-hint checks red on the same stack | `before/hotkeys/run.log` |
| before · drive-newtask-key (#1202 lane, run before the migration) | `waitForSelector('.search-panel')` 5s timeout crash | `before/newtask-key/run.log` |
| after · drive-hotkeys (#1202 lane) | 15/15 PASS | `after/hotkeys/run.log` + `result.json` |
| after · drive-newtask-key (#1202 lane) | 18/18 PASS | `after/newtask-key/run.log` + `result.json` |
| before · drive-hotkeys (#1205 lane, run before the migration) | the same-shaped red | `before-red/hotkeys/console.log` |
| before · drive-newtask-key (#1205 lane, run before the migration) | `waitForSelector('.search-panel')` 5s timeout crash | `before-red/newtask-key/console.log` |
| after · drive-hotkeys (#1205 lane) | 16/16 PASS | `after-green/hotkeys/result.json` (ok=true) + console.log |
| after · drive-newtask-key (#1205 lane) | 22/22 PASS | `after-green/newtask-key/result.json` (ok=true) + console.log |

A grep over both scripts shows zero retired-class residue (`search-panel` / `search-input-row`,
the audit-list occurrences excluded):

```sh
grep -n "search-panel\|search-input-row" \
  .claude/skills/verify-pacman/scripts/drive-hotkeys.mjs \
  .claude/skills/verify-pacman/scripts/drive-newtask-key.mjs
# (no matches)
```

## Reading gotchas (measured on both lanes)

- **The kbd-hint retirement is a second ledger of the same shape**: #1166 migrated only the search carrier, while
  `drive-hotkeys`'s ⌘J-hint assertion still pinned the #950-era `.kbd-hint` class — #1008 (the #983 verdict) swapped the chip for the registry Tooltip+Kbd, and the resting-state tooltip does not mount (`count()===0`),
  while the hover state floats out of a body-level portal. The ticket's lesion list named only the 5 search spots; this spot is the same shape as the root cause (a retired selector always runs red) and migrates with this ticket, the assertion shape aligned with the e2e
  hotkeys.spec's "robot FAB surfaces the ⌘J hint".
- **The ⌘J toggle semantics vs the old assertion's false red**: on the first after-run of the migration, the editable-guard
  reported `drawer=1` — the DOM-resident `.chief-drawer` (`display:none`) is constantly 1 under a `count()` assertion. The guard's real semantics is "not visible" (the #468 toggle law), not "zero nodes".

## Carrier map (retired selector -> current semantic carrier)

| retired selector | current carrier | where |
|---|---|---|
| `.search-panel` (wait open) | `role=dialog` named `搜索` | drive-hotkeys.mjs, drive-newtask-key.mjs |
| `.search-input-row input` | textbox inside the dialog scope | drive-hotkeys.mjs |
| `.search-panel` (wait hidden) | dialog detached / absent | drive-newtask-key.mjs |
| board row target | `[data-row-kind="todo"]` | drive-newtask-key.mjs |

The drawio variant of this map was removed: drawio diagrams are retired
(2026-10-11); this table is the canonical carrier reference for #1181.

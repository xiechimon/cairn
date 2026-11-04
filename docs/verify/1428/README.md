# #1428 shadows collected into a three-rung ladder + the dark top highlight — acceptance evidence

Only `apps/web/src/styles/tokens.css`, the e2e pins (the new `e2e/elevation-ladder.spec.ts`, registered in the `scripts/e2e-affected.mjs` family table) and the `apps/web/DESIGN.md` canon are touched; not a single consumption point changes.

## The ladder

| rung | pool (no ring) | rung (pool + 1px ring) | faces |
| --- | --- | --- | --- |
| 1 | `--cds-shadow-sm` | `--e1` | cards, rows, segmented-control white chips |
| 2 | `--cds-shadow-md` | `--e2` | menus, popovers, Select popups, overlay panels |
| 3 | `--cds-shadow-lg` | `--e3` | dialogs, the chief floating window |

- The ring is 1 CSS px (DESIGN.md's "all strokes are 1 CSS pixel", the `--sheet-ring` precedent), not `--hairline`. Light: all three rungs' ring color `--border`; dark: the e1 ring `--border`, the e2/e3 rings `--ring-inset-highlight` (the ring color from before the dialog ladder — `--border` is invisible on `--popover`).
- `--top`: dark `inset 0 1px 0 rgb(255 255 255 / 0.08)`, spliced only into the e2/e3 pools; light `inset 0 1px 0 rgb(255 255 255 / 0)` — a zero-alpha no-op instead of the ticket's `none`: `none` mixed into a comma list invalidates the whole box-shadow, and the Tailwind `shadow-(--x)` utility class always comma-splices five variables (a code-review finding; before the change the light pools also just wrote it literally without referencing it).
- Faces that draw their own `--edge-ring` (the notify bar's `--card-shadow`, the chief window / FAB's `--floating-shadow`) take the pool, not the rung — one ring per edge.
- All old slot names become aliases (`--panel-shadow → --e1`, `--shadow-popover → --e2`, `--dialog-shadow → --e3`, `--edge/fab/plate/chief-shadow → --e2`, `--card-shadow → pool sm`, `--floating-shadow → pool lg`, `--card-lift → --panel-shadow-hover`). The state slots (`--panel-shadow-hover`, `--shadow-composer*`) and the drag clone's `--drag-shadow` keep their literal values: a state is not a rung, and the composer's inset inner ring is preserved.

## Failure-mode-first list → where each is pinned

| # | failure mode | pinned by |
| --- | --- | --- |
| 1 | a rung loses its ring, or the ring is not last in the list | `elevation-ladder.spec`'s "each rung is its pool plus one ring, ring last" |
| 2 | `--top` leaks into e1 (a card face must not have it), or dark e2/e3 lack `--top` | "pools hold the pre-ladder darkness; --top only in dark e2/e3" |
| 3 | light `--top` is no longer a spliceable no-op (writing `none` into a rung value invalidates the whole) | same: light `--top` pinned to a zero-alpha value; light e2/e3 ≠ none and contain no inset |
| 4 | `.light` fails to redefine a rung and the light face inherits the dark pools | the ring-color assertions (light `--border` = rgb(236,229,218), dark e1 = rgb(45,41,38)) |
| 5 | an old slot name no longer points at the ladder; the pool is not equal to "rung minus ring" | "old slot names alias the ladder" + `value.startsWith(pool)` |
| 6 | double rings: a face with its own `--edge-ring` also gets an outer ring from the token | "one ring per edge on the rendered surfaces": card / notify bar / chief window / FAB / user menu / composer / dialog, ring count == 1 |
| 7 | the composer loses its inset inner ring | same + `shadow-composer*` contains `0px 0px 0px 1px inset` |
| 8 | dark pool lightness drift (#1396's work) | dark pool literals pinned: sm 40/40, md 65/45, lg 50/30 |
| 9 | existing pin values break (visual-polish / cds-dialogs `8px 28px` / paper-team-pages `0px 1px 2px` / chief-panel `inset`) | `04-e2e-pins.txt`: the 6 target specs 48/48 green |
| 10 | probe drift | `probe-comparison.md` (the full probe:dump) |

Tests precede the implementation: in `04-e2e-pins.txt` the spec first runs red against the old tokens (7 failures = the new spec's 7 items, the other 1096 green), then green after the token change.

## Measured table

`shadow-slots.md`: 18 slots x light/dark, per-row verdicts of the before/after computed values; the raw dumps are in `slots-before.json` / `slots-after.json` (including 1x/2x and 6 rendered faces), both measured on the branch base `498517de`, isolating this ticket's own changes.

After the branch merges into main (`66c7985c`, absorbing the #1396 dark final), one more measurement: `slots-after-merged.json`. The only difference from `slots-after.json` is in the dark rings' input colors: `--border` changes from #2d2926 to #3e3a34 (rgb(62, 58, 52)), and `--ring-inset-highlight` / `--border-soft` follow the new `--foreground`; the three rungs' shadow pools are byte-identical, and everything in light is identical. #1396 did not touch any shadow slot, so the ladder's derivations are unaffected.

The intentional-change list (everything else is equal or only has the ring moved to the end):

| slot | light | dark |
| --- | --- | --- |
| `--cds-shadow-sm` | two layers 5%/8% → the card-final pool `0 1px 2px` 4% (the only consuming face, the notify bar, lightens with it) | equal |
| `--cds-shadow-md` | the generic md → the menu pool | the generic md → the old popover's two layers + `--top` |
| `--cds-shadow-lg` | the generic lg → the dialog pool | the generic lg → the old dialog's two layers + `--top` |
| `--shadow-popover` | equal (ring moved to the end) | inset hairline ring → an outer 1px ring + `--top`; the shadow unchanged |
| `--dialog-shadow` | equal (ring moved to the end) | ring moved to the end + `--top`; the shadow and ring color unchanged |
| `--panel-shadow` | equal (ring moved to the end) | equal at 1x; at 2x the ring 0.5px → 1px |
| `--panel-shadow-hover` | equal | equal at 1x; at 2x the ring 0.5px → 1px, the same width as the e1 resting ring (a code-review finding: hover used to thin the ring) |
| `--floating-shadow` | Multica slate 14%/8% → the warm-ink dialog pool 16%/6% | 20/48 46% + 4/12 28% → 16/40 50% + 2/6 30% + `--top` |
| `--card-shadow` | changes with the pool sm | equal |
| `--edge/fab/plate/chief-shadow`, `--card-lift` | aliases (zero consumption points) | aliases (zero consumption points; plate dark `none` → e2) |

## Screenshots (`shots/`, dpr 2)

fixture two states: `board-{light,dark}.png` (the board's e1), `user-menu-{light,dark}.png` (the scenario-17-opened user menu, e2), `chief-window-{light,dark}.png` (scenario 111's chief window, the pool lg + its own edge-ring).
live real clicks: `live-new-task-dialog-{light,dark}.png` (the dialog opened by clicking `新任务` on the board top bar, e3; in dark see the 8% white highlight along the top edge).

## Gates

`01-lint.txt` (biome ci: 0 errors, the 1 info is the pre-existing machines-page.tsx noUselessFragments on main), `02-typecheck.txt`, `03-spec-parse.txt`, `04-e2e-pins.txt`, `05-e2e-affected.txt` (the styles/ change triggers the full fallback), `probe-comparison.md`.

## Skipped and registered

- **The ink-base primary button does not get `--top`**: in dark, Button default sits on a light ink base (`--primary` #eee8e4), and an 8% white highlight pressed onto it is 1-2 color steps away and invisible; light `--top` is `none`. Both sides are no-ops, adding it would be dead decoration, and `components/ui/button.tsx`'s class string is byte-identical to upstream.
- All dark lightness values carry over the old values (#1396's flip).
- spec 22 §2.4's four-tier table is a #915-era historical ledger (the values long diverged from tokens.css); this ticket does not change it — the canon is DESIGN.md.
- The zero-consumption-point `--edge-shadow` / `--fab-shadow` / `--plate-shadow` / `--chief-shadow` / `--card-lift` are aliased, not deleted, in this ticket (CLAUDE.md: ask before removing); the retirement is a separate ticket.
- ADR 0013 D2's "shadows aligned to the Multica original values" is registered as revised in the ADR's header (the chief window now walks the e3 pool).

## code-review (before opening the PR, high)

7 findings, 5 fixed: the alias assertions changed to booleans (values starting with oklab would be judged VIOLATION by probe-dump #411); the dark `--panel-shadow-hover` ring hairline → 1px; light `--top` changed from `none` to a zero-alpha value; the visual-polish stale comment; the DESIGN.md dark ring-color wording. 2 not fixed: deleting the zero-consumption slots (needs user confirmation, see above); ADR 0013 already has the revision line.

# #1428 shadow-slot measured table: before → after (computed box-shadow)

How values are taken: on the dev server (vite, the fixture scene `/app?scenario=01`) a bare `div` is created, `style.boxShadow = var(--slot)` is set, and `getComputedStyle().boxShadow` is read. 1x = deviceScaleFactor 1 (the e2e convention); the 2x column lists only the slots that differ from 1x.
"equal" = the same set of shadows (the ring is allowed to move from the head to the tail — the box-shadow list order only affects the paint order where items overlap, and a 1px ring does not overlap the low-alpha shadows).

## light

| slot | before | after | verdict |
| --- | --- | --- | --- |
| `--cds-shadow-sm` | `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | intentional change: the e1 pool = DESIGN.md's task-card final shadow (0 1px 2px 4%). The only consuming face is the notify bar (via --card-shadow), receiving the same pool as the card instead of two 5%/8% layers |
| `--cds-shadow-md` | `rgba(0, 0, 0, 0.05) 0px 2px 4px 0px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px` | intentional change: the e2 pool = the menu final shadow (the old --shadow-popover without its ring). No direct consumption point |
| `--cds-shadow-lg` | `rgba(0, 0, 0, 0.06) 0px 4px 8px 0px, rgba(0, 0, 0, 0.08) 0px 12px 28px -2px` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | intentional change: the e3 pool = the dialog final shadow (the old --dialog-shadow without its ring). Direct consumption points = the chief window and the FAB (via --floating-shadow) |
| `--edge-shadow` | `rgba(0, 0, 0, 0.05) 0px 2px 4px 0px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point |
| `--card-shadow` | `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | intentional change: alias → pool sm (the notify bar carries its own --edge-ring; it takes the pool, not the rung — one ring per edge). The value follows the pool |
| `--card-lift` | `rgba(28, 25, 23, 0.05) 0px 3px 10px 0px, rgba(28, 25, 23, 0.04) 0px 1px 3px 0px` | `oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px, rgba(80, 60, 30, 0.07) 0px 4px 14px 0px` | intentional change: alias → --panel-shadow-hover (a state, not a rung). No consumption point |
| `--shadow-popover` | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | equal (ring moved to the end) |
| `--shadow-composer` | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | equal |
| `--shadow-composer-hover` | `rgba(0, 0, 0, 0.06) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.06) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset` | equal |
| `--shadow-composer-focus` | `rgba(0, 0, 0, 0.08) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px` | `rgba(0, 0, 0, 0.08) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px` | equal |
| `--panel-shadow` | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | equal (ring moved to the end) |
| `--panel-shadow-hover` | `oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px, rgba(80, 60, 30, 0.07) 0px 4px 14px 0px` | `oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px, rgba(80, 60, 30, 0.07) 0px 4px 14px 0px` | equal |
| `--drag-shadow` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | equal |
| `--fab-shadow` | `rgba(0, 0, 0, 0.05) 0px 2px 4px 0px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point |
| `--plate-shadow` | `rgba(0, 0, 0, 0.12) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point (the V2 popup shell has retired) |
| `--dialog-shadow` | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | equal (ring moved to the end) |
| `--chief-shadow` | `rgba(28, 25, 23, 0.16) 0px 4px 24px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point (the drawer-head popover already goes through --shadow-popover) |
| `--floating-shadow` | `rgba(15, 23, 42, 0.14) 0px 16px 40px 0px, rgba(15, 23, 42, 0.08) 0px 3px 10px 0px` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | intentional change: alias → pool lg: warm ink 16/40 16% + 2/6 6% replaces Multica slate 14%/8%, the chief window on the same rung as the dialog; the chief window/FAB carry their own --edge-ring |

New slots:

| slot | value |
| --- | --- |
| `--e1` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` |
| `--e2` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` |
| `--e3` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` |
| `--top` | `rgba(255, 255, 255, 0) 0px 1px 0px 0px inset` |

Slots that differ between 2x and 1x (after):

- `--shadow-composer`: `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 0.5px inset`(the state slots' hairline ring still goes through --hairline, untouched by this ticket)
- `--shadow-composer-hover`: `rgba(0, 0, 0, 0.06) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 0.5px inset`(the state slots' hairline ring still goes through --hairline, untouched by this ticket)
- `--shadow-composer-focus`: `rgba(0, 0, 0, 0.08) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 0.5px inset, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 0.5px`(the state slots' hairline ring still goes through --hairline, untouched by this ticket)

## dark

| slot | before | after | verdict |
| --- | --- | --- | --- |
| `--cds-shadow-sm` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | equal |
| `--cds-shadow-md` | `rgba(0, 0, 0, 0.4) 0px 2px 4px 0px, rgba(0, 0, 0, 0.4) 0px 6px 16px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | intentional change: the e2 pool = the old --shadow-popover's two layers (lightness unchanged) + --top. No direct consumption point |
| `--cds-shadow-lg` | `rgba(0, 0, 0, 0.5) 0px 4px 8px 0px, rgba(0, 0, 0, 0.4) 0px 16px 36px -2px` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | intentional change: the e3 pool = the old --dialog-shadow's two layers (lightness unchanged) + --top. Direct consumption points = the chief window and the FAB |
| `--edge-shadow` | `rgba(0, 0, 0, 0.4) 0px 2px 4px 0px, rgba(0, 0, 0, 0.4) 0px 6px 16px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point |
| `--card-shadow` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | equal |
| `--card-lift` | `rgba(0, 0, 0, 0.14) 0px 4px 16px 0px, rgba(0, 0, 0, 0.08) 0px 1px 4px 0px` | `oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px, rgba(0, 0, 0, 0.09) 0px 4px 16px -2px` | intentional change: alias → --panel-shadow-hover. No consumption point |
| `--shadow-popover` | `oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | intentional change: inset hairline ring → an outer 1px ring (the ladder convention; the ring color is the same as the dialog's, --ring-inset-highlight) + --top; the two layers' lightness unchanged |
| `--shadow-composer` | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | equal |
| `--shadow-composer-hover` | `rgba(0, 0, 0, 0.55) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.55) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px inset` | equal |
| `--shadow-composer-focus` | `rgba(0, 0, 0, 0.65) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | `rgba(0, 0, 0, 0.65) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | equal |
| `--panel-shadow` | `rgb(45, 41, 38) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` | intentional change: at 1x the same set of values with the ring moved to the end; at 2x the ring 0.5px → 1px (DESIGN.md: all strokes are 1 CSS pixel, the --sheet-ring precedent) |
| `--panel-shadow-hover` | `oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px, rgba(0, 0, 0, 0.09) 0px 4px 16px -2px` | `oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px, rgba(0, 0, 0, 0.09) 0px 4px 16px -2px` | equal at 1x; at 2x intentional change: the ring 0.5px → 1px, the same width as the e1 resting ring, hover no longer thins the ring (code-review finding) |
| `--drag-shadow` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | equal |
| `--fab-shadow` | `rgba(0, 0, 0, 0.4) 0px 2px 4px 0px, rgba(0, 0, 0, 0.4) 0px 6px 16px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point |
| `--plate-shadow` | `none` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | intentional change: alias → --e2 (none → rung value). No consumption point; the hand-built plate ruled by #854 "dark wireframe load-bearing" retired with the V2 shell |
| `--dialog-shadow` | `oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | intentional change: ring moved to the end + --top; the two layers' shadow and ring color unchanged |
| `--chief-shadow` | `rgba(0, 0, 0, 0.35) 0px 4px 24px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | intentional change: alias → --e2. No consumption point |
| `--floating-shadow` | `rgba(0, 0, 0, 0.46) 0px 20px 48px 0px, rgba(0, 0, 0, 0.28) 0px 4px 12px 0px` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | intentional change: alias → pool lg: 16/40 50% + 2/6 30% + --top replaces 20/48 46% + 4/12 28%, the chief window on the same rung as the dialog; the chief window/FAB carry their own --edge-ring |

New slots:

| slot | value |
| --- | --- |
| `--e1` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` |
| `--e2` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` |
| `--e3` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` |
| `--top` | `rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` |

Slots that differ between 2x and 1x (after):

- `--shadow-composer`: `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 0.5px inset`(the state slots' hairline ring still goes through --hairline, untouched by this ticket)
- `--shadow-composer-hover`: `rgba(0, 0, 0, 0.55) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 0.5px inset`(the state slots' hairline ring still goes through --hairline, untouched by this ticket)
- `--shadow-composer-focus`: `rgba(0, 0, 0, 0.65) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 0.5px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 0.5px`(the state slots' hairline ring still goes through --hairline, untouched by this ticket)

## Rendered faces (not a single consumption point changed)

| face | theme | before | after | ring count |
| --- | --- | --- | --- | --- |
| todo-card | light | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 1 |
| notify-banner | light | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | 1 |
| user-menu | light | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 1 |
| composer | light | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | 1 |
| chief-drawer | light | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(15, 23, 42, 0.14) 0px 16px 40px 0px, rgba(15, 23, 42, 0.08) 0px 3px 10px 0px` | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | 1 |
| team-agent-card | light | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 1 |
| todo-card | dark | `rgb(45, 41, 38) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` | 1 |
| notify-banner | dark | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | 1 |
| user-menu | dark | `oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 1 |
| composer | dark | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | 1 |
| chief-drawer | dark | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.46) 0px 20px 48px 0px, rgba(0, 0, 0, 0.28) 0px 4px 12px 0px` | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | 1 |
| team-agent-card | dark | `rgb(45, 41, 38) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` | 1 |

(The rendered-face column drops the four zero-width `--tw-*` placeholder items that the tailwind `shadow-(--x)` utility class carries itself.)


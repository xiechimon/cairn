# #949 equivalence-migration parity table (human-review diff, #910 ruling 5 process)

Collection: `probe-parity.mjs` (this directory) replays the same script on two throwaway fixture stacks —
before = `origin/main` (034bf7d5, a /tmp throwaway worktree, port 8405), after = this branch (port 8406);
one round per theme, 40 measurement faces / 283 scalars per theme. The JSON originals are in `parity/`. Verdict classes:

- **CANON** = a canon-authorized intentional change (spec/22 §5.2 chip sm-tier growth)
- **CANON-SWAP** = better-colors measured failure → consumer-face slot swap per #908 ruling 2 (token values frozen)
- **CARRIER** = carrier reshaped, pixel-equivalent
- **ACCEPTED** = component-recipe delta (same-class record as the #943 precedent), imperceptible

## light: 283 scalars, KEPT 263, DRIFT 20

| measurement | before | after | verdict | reason |
| --- | --- | --- | --- | --- |
| `chip.box.h` | 14 | 16 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.box.w` | 32 | 34 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.box.x` | 932 | 930 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.box.y` | 230 | 229 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.borderRadius` | 9999px | 36.4px | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.fontWeight` | 400 | 500 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.height` | 14px | 16px | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.marginLeft` | 8.1875px | 6.1875px | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `inputRow.style.color` | rgb(141, 137, 128) | rgb(87, 83, 76) | CANON-SWAP | better-colors slot swap (#908 ruling 2): --text-dim×--popover-bg light 2.89 < floor 3 → --text-tertiary (contrast-949.md) |
| `kbdSelected.panelDataKbd` | True | False | CARRIER | the #159 hover-yield law moves from a data-kbd CSS override to a render-time conditional class (same-frame class swap, mechanism timing unchanged); the attribute retires with it |
| `menuContent.style.boxShadow` | rgba(0, 0, 0, 0.12) 0px 6px 16px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0p... | CARRIER | TW v4 shadow variable composition (transparent zero-width entries + the same true-value tail item); pixel-equivalent |
| `navRowRest.style.transitionProperty` | background-color | color, background-color, border-color, filter | ACCEPTED | Button component recipe transition table (same-class record on file as #943: the row face has no color-change face, invisible) |
| `panel.style.boxShadow` | rgba(28, 25, 23, 0.14) 0px 8px 24px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0p... | CARRIER | TW v4 shadow variable composition (transparent zero-width entries + the same true-value tail item); pixel-equivalent |
| `panel.style.transitionDuration` | 0.1s, 0.1s | 0.1s | CARRIER | single transition entry (the old CSS had two entries with the same 0.1s value) |
| `panel.style.transitionProperty` | opacity, transform | opacity, scale | CARRIER | the exit-scaling carrier transform → standalone scale property (TW v4, same law as the #943 lifted-card rotate); pixel-equivalent composition |
| `panel.style.transitionTimingFunction` | ease-out, ease-out | cubic-bezier(0, 0, 0.2, 1) | ACCEPTED | TW ease-out(0,0,0.2,1) vs CSS ease-out(0,0,0.58,1): the 100ms exit fade curve differs, imperceptible; the entry keyframe (VIEWPORT_POP_ANIM) is untouched |
| `popRow.img.borderRadius` | 9999px | 3.35544e+07px | CARRIER | the rounded-full computed serialization shape (3.35544e7px = circle); pixel-equivalent |
| `popSeq.color` | rgb(141, 137, 128) | rgb(87, 83, 76) | CANON-SWAP | better-colors slot swap (#908 ruling 2): --text-dim×--popover-bg light 2.89 < floor 3 → --text-tertiary (contrast-949.md) |
| `popover.style.boxShadow` | rgba(28, 25, 23, 0.14) 0px 8px 24px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0p... | CARRIER | TW v4 shadow variable composition (transparent zero-width entries + the same true-value tail item); pixel-equivalent |
| `rowTime.color` | rgb(141, 137, 128) | rgb(87, 83, 76) | CANON-SWAP | better-colors slot swap (#908 ruling 2): --text-dim×--popover-bg light 2.89 < floor 3 → --text-tertiary (contrast-949.md) |

## dark: 283 scalars, KEPT 264, DRIFT 19

| measurement | before | after | verdict | reason |
| --- | --- | --- | --- | --- |
| `chip.box.h` | 14 | 16 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.box.w` | 32 | 34 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.box.x` | 932 | 930 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.box.y` | 230 | 229 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.borderRadius` | 9999px | 36.4px | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.fontWeight` | 400 | 500 | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.height` | 14px | 16px | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `chip.style.marginLeft` | 8.1875px | 6.1875px | CANON | spec/22 §5.2 canon growth: mini 14px/400 → StatusChip sm 16px/Badge skeleton font-medium/rounded-4xl; ml-auto redistribution follows the width |
| `inputRow.style.color` | rgb(121, 117, 111) | rgb(179, 175, 168) | CANON-SWAP | better-colors slot swap (#908 ruling 2): --text-dim×--popover-bg light 2.89 < floor 3 → --text-tertiary (contrast-949.md) |
| `kbdSelected.panelDataKbd` | True | False | CARRIER | the #159 hover-yield law moves from a data-kbd CSS override to a render-time conditional class (same-frame class swap, mechanism timing unchanged); the attribute retires with it |
| `navRowRest.style.transitionProperty` | background-color | color, background-color, border-color, filter | ACCEPTED | Button component recipe transition table (same-class record on file as #943: the row face has no color-change face, invisible) |
| `panel.style.boxShadow` | rgba(0, 0, 0, 0.4) 0px 8px 24px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0p... | CARRIER | TW v4 shadow variable composition (transparent zero-width entries + the same true-value tail item); pixel-equivalent |
| `panel.style.transitionDuration` | 0.1s, 0.1s | 0.1s | CARRIER | single transition entry (the old CSS had two entries with the same 0.1s value) |
| `panel.style.transitionProperty` | opacity, transform | opacity, scale | CARRIER | the exit-scaling carrier transform → standalone scale property (TW v4, same law as the #943 lifted-card rotate); pixel-equivalent composition |
| `panel.style.transitionTimingFunction` | ease-out, ease-out | cubic-bezier(0, 0, 0.2, 1) | ACCEPTED | TW ease-out(0,0,0.2,1) vs CSS ease-out(0,0,0.58,1): the 100ms exit fade curve differs, imperceptible; the entry keyframe (VIEWPORT_POP_ANIM) is untouched |
| `popRow.img.borderRadius` | 9999px | 3.35544e+07px | CARRIER | the rounded-full computed serialization shape (3.35544e7px = circle); pixel-equivalent |
| `popSeq.color` | rgb(121, 117, 111) | rgb(179, 175, 168) | CANON-SWAP | better-colors slot swap (#908 ruling 2): --text-dim×--popover-bg light 2.89 < floor 3 → --text-tertiary (contrast-949.md) |
| `popover.style.boxShadow` | rgba(0, 0, 0, 0.4) 0px 8px 24px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0p... | CARRIER | TW v4 shadow variable composition (transparent zero-width entries + the same true-value tail item); pixel-equivalent |
| `rowTime.color` | rgb(121, 117, 111) | rgb(179, 175, 168) | CANON-SWAP | better-colors slot swap (#908 ruling 2): --text-dim×--popover-bg light 2.89 < floor 3 → --text-tertiary (contrast-949.md) |

## Human-review conclusion

Every DRIFT falls into one of the four authorized classes, zero UNCLASSIFIED; the geometry/skin/anchoring/interaction-state
measurement faces (panel box, row box, popover anchoring, Arrow, scrim, catcher, hover/selected/focus backgrounds, full-state
menu rows) are KEPT value by value. probe:dump (the #921 tool, 12 re-pinned specs):
47 visual rows KEPT 47 / DRIFT 0 / VIOLATION 0 / NOT-RUN 0 (`probe-dump/probe-comparison.md`).

# #949 overlays/ domain better-colors contrast measurement (no estimating)

Measurement face: the verify-pacman live stack (8795/5277, isolated PACMAN_HOME), section E of `drive-949-overlays.mjs`;
rendered pairs take real-element computed colors, token-resolved pairs walk a var() probe-div; transparent/semi-transparent
bases are composited onto the real canvas. WCAG 2.x relative-luminance formula; text floor 4.5, non-text UI floor 3.0;
report-only = the spec/22 §1.3 soft-hairline family (reported, never judged red).

**Consumer-face slot swap (authorized by #908 ruling 2, token values frozen)**: `--text-dim × --popover-bg` measured
2.89:1 in light < the slot's canon floor 3 (§1.8's 3.05:1 is the on `--background` pair; the brighter popover base
presses it through the floor) — the three consumption points (time column / sequence number / magnifier) swap to
`--text-tertiary` (light 4.97 / dark 7.35, see the row-time / popover-seq / input-icon rows below),
the same precedent as the #943 notify-banner.

## dark (27 gated pairs + 3 report-only pairs)

| face | fg | bg | ratio | floor | verdict |
| --- | --- | --- | --- | --- | --- |
| row-text | rgb(211 207 199) | rgb(37 34 29) | 10.2:1 | 4.5 | PASS |
| row-title | rgb(237 233 225) | rgb(37 34 29) | 13.09:1 | 4.5 | PASS |
| row-sub | rgb(179 175 168) | rgb(37 34 29) | 7.25:1 | 4.5 | PASS |
| row-time | rgb(179 175 168) | rgb(37 34 29) | 7.25:1 | 4.5 | PASS |
| chip-idle-rendered | rgb(179 175 168) | rgb(45 42 36) | 6.55:1 | 4.5 | PASS |
| group-label | rgb(179 175 168) | rgb(37 34 29) | 7.25:1 | 4.5 | PASS |
| input-text | rgb(237 233 225) | rgb(37 34 29) | 13.09:1 | 4.5 | PASS |
| row-text-lit | rgb(211 207 199) | rgb(45 42 36) | 9.21:1 | 4.5 | PASS |
| icon-tile-glyph | rgb(179 175 168) | rgb(63 60 54) | 5.03:1 | 3 | PASS |
| chip-idle-token | rgb(179 175 168) | rgb(45 42 36) | 6.55:1 | 4.5 | PASS |
| chip-plan-token | rgb(224 175 255) | rgb(62 51 60) | 6.73:1 | 4.5 | PASS |
| chip-confirm-token | rgb(244 185 115) | rgb(66 43 13) | 7.6:1 | 4.5 | PASS |
| chip-done-token | rgb(141 219 162) | rgb(25 56 34) | 7.84:1 | 4.5 | PASS |
| chip-failed-token | rgb(255 170 185) | rgb(71 36 43) | 7.52:1 | 4.5 | PASS |
| popover-title | rgb(237 233 225) | rgb(37 34 29) | 13.09:1 | 4.5 | PASS |
| popover-row | rgb(179 175 168) | rgb(37 34 29) | 7.25:1 | 4.5 | PASS |
| popover-row-selected | rgb(179 175 168) | rgb(62 51 60) | 5.51:1 | 4.5 | PASS |
| popover-label-selected | rgb(237 233 225) | rgb(62 51 60) | 9.93:1 | 4.5 | PASS |
| popover-seq | rgb(179 175 168) | rgb(37 34 29) | 7.25:1 | 4.5 | PASS |
| input-icon | rgb(179 175 168) | rgb(37 34 29) | 7.25:1 | 3 | PASS |
| popover-check | rgb(216 156 252) | rgb(62 51 60) | 5.77:1 | 3 | PASS |
| popover-divider | rgb(45 42 36) | rgb(37 34 29) | 1.11:1 | — | report-only |
| panel-border | rgb(45 42 36) | rgb(37 34 29) | 1.11:1 | — | report-only |
| popover-border | rgb(45 42 36) | rgb(30 27 22) | 1.2:1 | — | report-only |
| project-avatar | rgb(71 38 26) | rgb(255 155 120) | 6.55:1 | 4.5 | PASS |
| menu-row | rgb(237 233 225) | rgb(37 34 29) | 13.09:1 | 4.5 | PASS |
| menu-row-checked | rgb(237 233 225) | rgb(62 51 60) | 9.93:1 | 4.5 | PASS |
| menu-indicator | rgb(216 156 252) | rgb(62 51 60) | 5.77:1 | 3 | PASS |
| focus-ring | rgb(216 156 252) | rgb(37 34 29) | 7.61:1 | 3 | PASS |
| sidebar-dim-row | rgb(211 207 199) | rgb(30 27 22) | 11.05:1 | 4.5 | PASS |

## light (27 gated pairs + 3 report-only pairs)

| face | fg | bg | ratio | floor | verdict |
| --- | --- | --- | --- | --- | --- |
| row-text | rgb(53 49 42) | rgb(239 233 225) | 10.72:1 | 4.5 | PASS |
| row-title | rgb(18 15 9) | rgb(239 233 225) | 15.86:1 | 4.5 | PASS |
| row-sub | rgb(87 83 76) | rgb(239 233 225) | 6.34:1 | 4.5 | PASS |
| row-time | rgb(87 83 76) | rgb(239 233 225) | 6.34:1 | 4.5 | PASS |
| chip-idle-rendered | rgb(87 83 76) | rgb(232 227 218) | 5.98:1 | 4.5 | PASS |
| group-label | rgb(87 83 76) | rgb(239 233 225) | 6.34:1 | 4.5 | PASS |
| input-text | rgb(18 15 9) | rgb(239 233 225) | 15.86:1 | 4.5 | PASS |
| row-text-lit | rgb(53 49 42) | rgb(232 227 218) | 10.12:1 | 4.5 | PASS |
| icon-tile-glyph | rgb(87 83 76) | rgb(224 219 210) | 5.55:1 | 3 | PASS |
| chip-idle-token | rgb(87 83 76) | rgb(232 227 218) | 5.98:1 | 4.5 | PASS |
| chip-plan-token | rgb(86 32 113) | rgb(223 207 217) | 7.63:1 | 4.5 | PASS |
| chip-confirm-token | rgb(130 81 0) | rgb(255 229 200) | 5.53:1 | 4.5 | PASS |
| chip-done-token | rgb(0 76 35) | rgb(194 245 206) | 8.38:1 | 4.5 | PASS |
| chip-failed-token | rgb(107 31 51) | rgb(255 220 225) | 8.87:1 | 4.5 | PASS |
| popover-title | rgb(18 15 9) | rgb(239 233 225) | 15.86:1 | 4.5 | PASS |
| popover-row | rgb(87 83 76) | rgb(239 233 225) | 6.34:1 | 4.5 | PASS |
| popover-row-selected | rgb(87 83 76) | rgb(223 207 217) | 5.11:1 | 4.5 | PASS |
| popover-label-selected | rgb(18 15 9) | rgb(223 207 217) | 12.79:1 | 4.5 | PASS |
| popover-seq | rgb(87 83 76) | rgb(239 233 225) | 6.34:1 | 4.5 | PASS |
| input-icon | rgb(87 83 76) | rgb(239 233 225) | 6.34:1 | 3 | PASS |
| popover-check | rgb(127 45 167) | rgb(223 207 217) | 4.95:1 | 3 | PASS |
| popover-divider | rgb(232 227 218) | rgb(239 233 225) | 1.06:1 | — | report-only |
| panel-border | rgb(232 227 218) | rgb(239 233 225) | 1.06:1 | — | report-only |
| popover-border | rgb(232 227 218) | rgb(244 239 231) | 1.12:1 | — | report-only |
| project-avatar | rgb(49 10 0) | rgb(205 95 55) | 4.5:1 | 4.5 | PASS |
| menu-row | rgb(18 15 9) | rgb(239 233 225) | 15.86:1 | 4.5 | PASS |
| menu-row-checked | rgb(18 15 9) | rgb(223 207 217) | 12.79:1 | 4.5 | PASS |
| menu-indicator | rgb(127 45 167) | rgb(223 207 217) | 4.95:1 | 3 | PASS |
| focus-ring | rgb(127 45 167) | rgb(239 233 225) | 6.14:1 | 3 | PASS |
| sidebar-dim-row | rgb(53 49 42) | rgb(244 239 231) | 11.3:1 | 4.5 | PASS |

Conclusion: all 27 gated pairs × both themes pass, domain minimum 4.5:1. The three report-only pairs match the §1.7/1.8 table values digit by digit (the 1.06-1.2 soft-hairline family).

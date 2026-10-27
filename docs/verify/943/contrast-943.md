# #943 board/sidebar domain contrast measurement (better-colors, no estimating)

Method: `drive-943-board-sidebar.mjs` (run artifacts in live-stack/drive-943-board-sidebar/) takes **rendered-element computed colors** (nav rows / selected-row pill composite face / kbd badges / column headers / card titles / filter buttons) and **token-resolved pairs** (a probe-div walking var() resolution, for state colors and dual-face components) on the live stack (8795/5277, isolated PACMAN_HOME), computing ratios with the WCAG 2.x relative-luminance formula. Transparent/semi-transparent bases are always composited onto the actual canvas (--background or the sidebar base) before computing. Floors: text 4.5, non-text UI 3.0. 16 pairs per theme.

| face | kind | dark fg / bg / ratio | light fg / bg / ratio | floor | verdict |
|---|---|---|---|---|---|
| `sidebar-nav-text` | text | `rgb(179 175 168)` on `rgb(30 27 22)` = **7.86** | `rgb(53 49 42)` on `rgb(244 239 231)` = **11.3** | 4.5 | PASS |
| `sidebar-selected-pill` | text | `rgb(179 175 168)` on `rgb(53 50 45)` = **5.88** | `rgb(53 49 42)` on `rgb(222 218 210)` = **9.26** | 4.5 | PASS |
| `sidebar-kbd` | text | `rgb(179 175 168)` on `rgb(30 27 22)` = **7.86** | `rgb(53 49 42)` on `rgb(244 239 231)` = **11.3** | 4.5 | PASS |
| `column-header` | text | `rgb(179 175 168)` on `rgb(30 27 22)` = **7.86** | `rgb(53 49 42)` on `rgb(244 239 231)` = **11.3** | 4.5 | PASS |
| `card-title` | text | `rgb(237 233 225)` on `rgb(37 34 29)` = **13.09** | `rgb(18 15 9)` on `rgb(239 233 225)` = **15.86** | 4.5 | PASS |
| `filter-trigger` | text | `rgb(237 233 225)` on `rgb(30 27 22)` = **14.17** | `rgb(18 15 9)` on `rgb(244 239 231)` = **16.71** | 4.5 | PASS |
| `focus-ring` | ui | `rgb(216 156 252)` on `rgb(30 27 22)` = **8.24** | `rgb(127 45 167)` on `rgb(244 239 231)` = **6.47** | 3 | PASS |
| `checkbox-check` | text | `rgb(30 27 22)` on `rgb(216 156 252)` = **8.24** | `rgb(250 250 250)` on `rgb(127 45 167)` = **7.09** | 4.5 | PASS |
| `invert-link` | text | `rgb(216 156 252)` on `rgb(37 34 29)` = **7.61** | `rgb(127 45 167)` on `rgb(239 233 225)` = **6.14** | 4.5 | PASS |
| `project-avatar` | text | `rgb(71 38 26)` on `rgb(255 155 120)` = **6.55** | `rgb(49 10 0)` on `rgb(205 95 55)` = **4.5** | 4.5 | PASS |
| `notify-title` | text | `rgb(237 233 225)` on `rgb(45 42 36)` = **11.81** | `rgb(18 15 9)` on `rgb(232 227 218)` = **14.96** | 4.5 | PASS |
| `notify-body` | text | `rgb(179 175 168)` on `rgb(45 42 36)` = **6.55** | `rgb(53 49 42)` on `rgb(232 227 218)` = **10.12** | 4.5 | PASS |
| `option-count` | text | `rgb(179 175 168)` on `rgb(37 34 29)` = **7.25** | `rgb(53 49 42)` on `rgb(239 233 225)` = **10.72** | 4.5 | PASS |
| `badge-attention` | text | `rgb(66 43 13)` on `rgb(238 169 83)` = **6.59** | `rgb(76 46 0)` on `rgb(250 171 63)` = **6.46** | 4.5 | PASS |
| `filter-chip` | text | `rgb(30 27 22)` on `rgb(237 233 225)` = **14.17** | `rgb(244 239 231)` on `rgb(18 15 9)` = **16.71** | 4.5 | PASS |
| `drop-tint-border` | ui | `rgb(216 156 252)` on `rgb(30 27 22)` = **8.24** | `rgb(127 45 167)` on `rgb(244 239 231)` = **6.47** | 3 | PASS |

**Conclusion: 16 pairs × 2 themes = 32 measurements all pass, 0 failures; the domain's lowest ratio is 4.5:1 (light project-avatar, passing exactly on the 4.5 line).**

## The one spot caught by measurement and fixed (this ticket's only color-face change)

The `notify-banner` body used to pair `--text-dim × --surface-secondary`: dark 3.12:1 / light **2.73:1** — below the floor 3 that spec/22 §1.7 sets for `--text-dim` (the canon gated pair is text-dim × --background; this face's base is surface-secondary, the pair is self-made by the #114 face and never entered the canon ledger). 12px body text needs 4.5 under AA. Disposition: swap to the role-correct secondary-text token `--muted-foreground` (the same idiom as the in-repo todo-card time/column counts), after which dark 6.55 / light 10.12 (the notify-body row above). Token values untouched (shadcn.css frozen) — only the consumer-face slot reference moved.

## Observation (unchanged, recorded)

The `sidebar-selected-pill` row's fg = muted-foreground: the selected row's `text-foreground` (ROW_SELECTED) and the row base's `text-muted-foreground` (ROW_BASE) coexist in a template string without tailwind-merge, and compile order makes muted always win — **the existing rendered state since #414** (the selection signal is carried by the pill; this ticket's probe passes at 5.88/9.26 in both themes). After the class-name carrier retires, this conflict face goes to the #952/#953 final ledger and is not touched in this ticket (touching it would be a visual-semantics change, a behavior face beyond D2's authorization).

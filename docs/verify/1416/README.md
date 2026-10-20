# Clickable resource rows keep the card divider (#1416): evidence

The skills page with three clickable skill rows (new fixture scenario
`skills-list`). Shots are 1440x900 at DPR 2, light and dark, from a
`vite build --mode fixture` bundle served by `vite preview`. Both bundles
carry the new scenario; before = `ResourceRow` as on main, after = this
branch.

    node docs/verify/1416/capture.mjs <before|after> http://127.0.0.1:<port>

| shot | what it shows |
| --- | --- |
| `*-skills.png` | the full page |
| `*-skills-card.png` | the list card alone, so the 1px rules are visible |

`before-metrics.json` / `after-metrics.json` hold each row's borders:

| | top | bottom | bottom color (light) |
| --- | --- | --- | --- |
| before, rows 1 to 3 | 1px | 1px | `rgba(0, 0, 0, 0)` |
| after, rows 1 and 2 | 0px | 1px | `rgb(236, 229, 218)` = `--border` |
| after, row 3 | 0px | 0px | |

Before, each row is a Button whose own `border border-transparent` outranks
the card's zero-specificity `divide-y` rule, so the divider is transparent.
After, the row keeps only a bottom border in `--border` and drops it on the
last row. Dark theme shows the same with `--border` = `rgb(45, 41, 38)`.

Gate output: `gates.txt`. e2e: `e2e.txt`.

---
name: cairn-type
description: Typography for apps/web/src — the type scale steps, line-height, tracking, wrapping, truncation, tabular figures and punctuation, through the vendored better-typography skill with Cairn overrides. Load when a UI change under apps/web/src touches text rendering, fonts, sizes, wrapping or truncation.
---

# cairn-type

Type work starts from `upstream/README.md` — a verbatim copy of Jakub Krehel's `better-typography` at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`). The upstream `SKILL.md` is vendored as `upstream/README.md`; links in its reference files that say `SKILL.md` point there. Read it first, then the reference file for the recipe needed (`spacing-and-sizing.md`, `wrapping-and-punctuation.md`, `variable-fonts-and-opentype.md`, `details-and-accessibility.md`, `choosing-fonts.md`, `css-cheat-sheet.md`).

## Cairn overrides

Where this table differs from upstream, Cairn wins. An upstream rule not listed applies as written — upstream's own calibration says a deliberate, consistent project convention is a preference and not a finding.

| Upstream rule | Cairn | Rules |
|---|---|---|
| `-webkit-font-smoothing: antialiased` on the root | Banned outright: no font smoothing anywhere; on macOS `antialiased` removes stem darkening and every glyph reads thinner than native | V25 |
| Headings at 24px+ take `-0.01em` to `-0.02em`; small caps labels `0.05em` | `letter-spacing: normal` on every text node (measured on claude.ai) and no uppercase labels | V22 |
| A type scale with semantic names | The fixed eight-step scale already does this: `text-greeting` / `text-page` / `text-brand` / `text-heading` / `text-card-title` / `text-ui` / `text-meta` / `text-code` / `text-caption`, never arbitrary sizes; at most 6 sizes, 3 weights and 9 pairs per screen | V13, V1 |
| Weight `400`+ under 18px; `100`–`300` at 28px+ | Adds: no weight of 800 or more anywhere and no italic in chrome; emphasis is weight or an ink step | V23 |
| `font-variant-numeric: tabular-nums` on changing values | Same, and it is measured: every count, time and figure renders in tabular figures | V27 |
| Never propose a typeface unless asked | Fixed set: Source Serif 4, Instrument Sans and JetBrains Mono only | V2 |
| Inputs at 16px on mobile (iOS zoom) | N/A — Cairn is a Mac desktop app; the 390px layout is a narrow window, not mobile Safari | R1 |
| 60–75 char measure, `text-wrap`, typographic punctuation | Applies to prose. UI strings are Chinese-first through `t()`: keep glossary terms, fullwidth punctuation and plain copy (no hype words, no trailing period on labels) | T1, T4 |
| Unitless line-height, `rem` sizes | Applies; the token steps already pair each size with its leading | V1 |
| Truncate with a way back | Applies; the title gets the row's width and a truncated value keeps the meaningful part | L4 |

## Before wrap-up

Run the upstream **Before you finish** detection table over the diff, with this table's overrides applied. Check each touched state at 1440px and 390px, light and dark (R1), with realistic CJK and Latin strings, and name the rule ids checked in the wrap-up.

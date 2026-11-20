---
name: cairn-polish
description: Surface and icon polish for apps/web/src — concentric radii, optical alignment, shadows and elevation, image outlines, hover gating, overscroll and icon states, through the vendored better-ui skill with Cairn overrides. Load when a UI change under apps/web/src touches surfaces, cards, shadows, borders, radii or icons.
---

# cairn-polish

Polish work starts from `upstream/README.md` — a verbatim copy of Jakub Krehel's `better-ui` at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`). The upstream `SKILL.md` is vendored as `upstream/README.md`; links in its reference files that say `SKILL.md` point there. Read it first, then `upstream/surfaces.md` or `upstream/icons.md` for the recipe needed. Polish never outranks a broken interaction.

## Cairn overrides

Where this table differs from upstream, Cairn wins. An upstream rule not listed applies as written — upstream's own calibration says a deliberate, consistent project convention is a preference and not a finding.

| Upstream rule | Cairn | Rules |
|---|---|---|
| Shadows for elevation, borders for structure | Floating surfaces only (menus, popovers, dialogs): the `--e2` ring plus soft shadow. Cards and page surfaces keep their outline and ring treatment, and no hover shadows anywhere | V7, V21 |
| Outer radius = inner radius + padding | Applies; radii come from tokens (`--radius-card`, `--radius-popover`, `--radius-menu-item`, `--radius-control`) and a page carries one card corner | V1, V4 |
| Align optically where geometry looks off | Applies, and it is measured: a status glyph or mark sits on the optical centre of its box, and a nudge lives on the glyph itself | V29 |
| Match icon stroke to text weight (1.5–2.5px) | Fixed instead: every lucide icon renders `stroke-width` 1.75px at 16, 20 or 22px per its slot — never vary stroke by neighbouring text weight | V14, V9 |
| One SVG recolored per state, `currentColor` | Applies; state ink comes from tokens and status is icon, color and text together, never color alone | V5, V9 |
| Hover styling behind `@media (hover: hover)` | Applies; Tailwind 4's `hover:` already compiles under that query, so plain `hover:` is safe and raw CSS `:hover` needs the media query | — |
| `overscroll-behavior: contain` on overlays | Applies to menus, dialogs, drawers and side panels | — |
| `1px` image outline, `oklch(0 0 0 / 0.1)` light / `oklch(1 0 0 / 0.1)` dark | Applies to content images; skip brand marks and transparent artwork | — |

## Before wrap-up

Run the upstream **Before you finish** detection table over the diff, with this table's overrides applied. Check each touched state at 1440px and 390px, light and dark (R1), and name the rule ids checked in the wrap-up.

---
name: cairn-polish
description: Surface and icon polish for apps/web/src — concentric radii, optical alignment, shadows and elevation, image outlines, hover gating, overscroll, icon states, colour roles, layout grouping, the 390px narrow window and toasts, through vendored better-ui, better-colors, better-layout, mobile-native and ask-sonner with Cairn overrides. Load when a UI change under apps/web/src touches surfaces, cards, shadows, borders, radii, icons, colour, spacing, grouping, a narrow window or a toast.
---

# cairn-polish

Polish work has five routes. Start with the one the change is about:

| Route | Read | For |
|---|---|---|
| Surfaces and icons | `upstream/README.md` (Jakub `better-ui`), then `upstream/surfaces.md` or `upstream/icons.md` | Cards, radii, shadows, borders, hover, overscroll, icon states |
| Colour | `upstream/better-colors/README.md`, then `contrast.md`, `token-naming.md`, `color-usage.md`, `palette-structure.md` | A colour role, a token name, a contrast pair |
| Layout | `upstream/better-layout/README.md`, then `grouping-and-alignment.md`, `spacing-and-adaptivity.md` | Grouping, alignment, shared edges, a row or form structure |
| Narrow window | `references/mobile-native/README.md` | Anything at 390px, and the web UI opened from a phone |
| Toasts | `references/ask-sonner/README.md` + `API.md` | A toast, its action, its life, its styling |

The four `upstream/` roots are verbatim copies of Jakub Krehel's skills at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`); `references/` holds Emil Kowalski's `mobile-native` and `ask-sonner` plus his two one-page cheatsheets at `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (MIT, `references/LICENSE`). Each upstream `SKILL.md` is vendored as `README.md`; links inside a vendored file that say `SKILL.md` point there. `references/ui-cheatsheet.md` is the one-page summary — where it disagrees with a table below, the table wins.

Polish never outranks a broken interaction.

## Cairn overrides

Where this table differs from upstream, Cairn wins. An upstream rule not listed applies as written — upstream's own calibration says a deliberate, consistent project convention is a preference and not a finding. When two of their values disagree and this table is silent, name both in the report and pick the one the nearest row implies; never average them.

| Upstream rule | Cairn | Rules |
|---|---|---|
| Shadows for elevation, borders for structure | Floating surfaces only (menus, popovers, dialogs): the `--e2` ring plus soft shadow. Cards and page surfaces keep their outline and ring treatment, and there is no hover shadow anywhere | V7, V21 |
| Outer radius = inner radius + padding | Applies; radii come from tokens (`--radius-card`, `--radius-popover`, `--radius-menu-item`, `--radius-control`) and a page carries one card corner | V1, V4 |
| Align optically where geometry looks off | Applies, and it is measured: a status glyph or mark sits on the optical centre of its box, and a nudge lives on the glyph itself | V29 |
| Match icon stroke to text weight (1.5–2.5px) | Fixed instead: every lucide icon renders `stroke-width` 1.75px at 16, 20 or 22px per its slot — never vary stroke by neighbouring text weight | V14, V9 |
| One SVG recolored per state, `currentColor` | Applies; state ink comes from tokens and status is icon, color and text together, never colour alone | V5, V9 |
| Hover styling behind `@media (hover: hover)` | Applies; Tailwind 4's `hover:` already compiles under that query, so plain `hover:` is safe and raw CSS `:hover` needs the media query | — |
| `overscroll-behavior: contain` on overlays | Applies to menus, dialogs, drawers and side panels | — |
| `1px` image outline, `oklch(0 0 0 / 0.1)` light / `oklch(1 0 0 / 0.1)` dark | Applies to content images; skip brand marks and transparent artwork | — |
| `oklch()` is the best default for a new colour system; reuse the project's notation | Cairn has one notation: hex values in the `apps/web/DESIGN.md` frontmatter and the tokens in `src/styles/shadcn.css`, both themes. A new colour is added there as a role token, never inline, and `oklch()` appears only inside `color-mix()` on an existing token | V1, V3 |
| One neutral ramp, one accent ramp, and only the status ramps the product renders | Cairn encodes meaning, not ramps: ochre is waiting on you, green is running, rust is failure, plus the task tints and the count badge. At most 2 non-neutral hue families per screen beyond those roles, at most 3 tinted short-text badges, and at most 2 hues in one list | V5, V12, V15, L1 |
| Every ramp step has a job; primitives named by hue, semantics by role; a component reads only semantic tokens | The semantic tier is the only one a component reads: `--card`, `--ink-1..4`, `--line`/`--rule`, `--tint-*`, `--pebble-*`. A token is never borrowed for its value, and a project or list row carries no colour at all | V1, V4, V11, L3 |
| One filled action per view, colour on the background not the label | Applies: one `primary` Button per screen, card actions are text links, sibling settings actions share `outline` | V6 |
| Measure the rendered pair against the background it actually renders on, in both themes, then report without changing it | Applies and is a gate: 0 axe violations, plus the dark tertiary measure. Report the pair and its threshold, leave the colour to the owner unless asked | A3 |
| Pick a gradient's interpolation space | N/A: no gradient, texture or glow on a surface | V3, V16 |
| The numbers apply only where the project has no spacing scale; otherwise use its tokens | Cairn's 4px grid and the token steps decide; a computed margin or padding off the grid is a finding | V8, V1 |
| Group with space, not lines; the gap between groups is at least 2× the gap within one | Same, and the vehicle is fixed: object lists and settings groups are rows in one divided `ListCard`, never a grid of identical cards, never a card inside a card | V4, V20 |
| Keep controls distinct from content; borderless controls need more clearance; hit areas never overlap | Applies inside chrome: a borderless icon control keeps its hover background, its name and a `24px` hit area, and an element shown on hover or focus takes no layout when hidden | A1, C3, C4 |
| Order by importance; hint at hidden content; keep critical actions out of clipped regions | Applies, plus the row-geometry rule: a row of controls or fields fills its card, with no blank region of 40% of its width at one side | V30 |
| Logical properties for anything that mirrors | No mirrored locale ships (`LOCALES` is `zh` and `en`); write logical properties where they cost nothing and physical ones where the geometry is physical. The narrow bar is 390px on a desktop window in both themes | R1 |
| Breakpoints come from the content; plan for growth and clipping; test a long-string locale | Applies: the narrow bar is 390px with no horizontal scroll, and the strings that grow are English beside the Chinese source, so check the same row in both | R1, L4 |
| Content bleeds, controls float; `scroll-padding-block-start` under sticky chrome | The shell's 56px header and 220px sidebar come from the `spacing` frontmatter; a focused or anchored target never lands under the header | V1, R1 |
| The mobile symptom table fixes sticky hover, tap flash, `100vh`, notch insets, pull-to-refresh and long-press selection | Cairn is Mac first, and the same UI is opened from a phone over the LAN or tailnet. Tailwind's `hover:` is already gated; `dvh` replaces `100vh` where a panel is full height; the notch and status-bar rows apply only with `viewport-fit=cover`. The `16px` input row is the real mobile-Safari case, owned by the type route | R1 |
| Sonner is the toast library; pick the call, keep the styling minimal, share one `Toaster` | Cairn wraps it: `components/ui/toaster.tsx` exposes `toastSuccess(title, action?)`, `toastError(title, error)` and passes anything else through Sonner's `toast`. A toast that carries an action or an error stays until dismissed; a diagnostic check is a popover that switches in place, never a toast; no raw error text reaches the user | C5, C22, C24 |
| Scaling, tracking and blur rows of the UI cheatsheet | These belong to the other wrappers: press and easing to `cairn-motion`, tracking and measurement to `cairn-type`, colour to the colour route above. The cheatsheet's copy rows are `cairn-copy` | V22, V24 |

## Before wrap-up

Run each touched route's **Before you finish** detection table over the diff, with this table's overrides applied. Check each touched state at 1440px and 390px, light and dark (R1), and name the rule ids checked in the wrap-up.

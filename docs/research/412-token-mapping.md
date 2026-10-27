# #412 first draft — tokens.css 117 names → shadcn official semantic vocabulary / fill-in families / non-color

Direction already ruled (issue #412): **the value canonical copy moves to the shadcn official semantic vocabulary + in-repo fill-in families; legacy generic names are demoted to aliases**.
This file only does mechanical data collection and a first draft: lining up the 117 distinct names, flagging the risk points, **making no final ruling** — the item-by-item ruling authority rests with a human.

**Ruling landed (2026-09-29; the user agreed to all four items) — see the "Ruling" section at the end. The final assignment of each row in the tables is derived from the four rules in that section; the "suggested classification" column in this file serves only as audit input.**

## Caliber notes

- **Collection source**: `apps/web/src/styles/tokens.css` (365 lines). `:root` = dark default (lines 11–230), `.light` = the light mirror (lines 232–365).
- **Total**: `grep -oE '^\s*--[a-z0-9-]+:' tokens.css | sort -u` = **117** (matches the 117 in the task statement).
- **Consumption counts**: per the task-specified caliber `grep -rhoE 'var\(--[a-z0-9-]+\)' apps/web/src --include='*.css' --include='*.tsx' --include='*.ts' | sort | uniq -c`, **scope = `apps/web/src`** (excluding `apps/web/e2e`, `integration/`, `docs/`).
  - This caliber has **two systematic biases** that must be carried when reading the tables:
    1. **Includes aliases' own definitions**: alias lines like `--sidebar-bg: var(--surface)` count the target name (`--surface`) +1/+2 (once in :root and once in .light). That is, `--surface`'s 41 includes 2 counts from alias definitions, not real page consumption.
    2. **Misses Tailwind v4 shorthand**: `bg-(--badge-attention)` / `text-(--x)` forms contain no `var(` and escape the specified regex. A supplementary scan of `(?<!var)\(--[a-z0-9-]+\)` across `apps/web/src/**/*.{ts,tsx,css}` finds 5 more real consumption points: `--badge-attention`, `--badge-done`, `--badge-idle`, `--surface-hover`, `--stop`, each +1. **Among them `--badge-attention` is consumed only via shorthand — 0 under the specified caliber, but not actually dead**.
- **"Not mirrored"**: the name is defined only in `:root` and not redeclared in `.light` → same value in both themes (mostly palette primitives and motion/font/geometry constants).
- **Alias form**: names whose value is `var(--elsewhere)` are written `alias → --target`, marked in the "dark value" column.
- **`[inference]` marks**: names whose comments explicitly say "dark value [inference]" (no dark capture, derived from the same family) keep that mark in the "use" column — for these names the value itself carries uncertainty at merge time.
- Official target vocabulary (given by the task, the Base UI generation): `background/foreground`, `card/card-foreground`, `popover/popover-foreground`, `primary/primary-foreground`, `secondary/secondary-foreground`, `muted/muted-foreground`, `accent/accent-foreground`, `destructive/destructive-foreground`, `border`, `input`, `ring`, `chart-1..5`, the 8-name sidebar family, `radius`.
- **`shadcn.css` current values (used for "is the value equivalent" comparisons)**: dark `--background #0a0a0a` / `--foreground #fafafa` / `--card #171717` / `--popover #171717` / `--primary #e5e5e5` / `--primary-foreground #171717` / `--secondary #262626` / `--muted #262626` / `--muted-foreground #a1a1a1` / `--accent #404040` / `--destructive #ff6467` / `--border rgb(255 255 255 / 0.1)` / `--input rgb(255 255 255 / 0.15)` / `--ring #737373` / `--column #121212` / `--radius 0.625rem`; light `--background #ffffff` / `--foreground #0a0a0a` / `--card #ffffff` / `--primary #171717` / `--secondary #f5f5f5` / `--muted #f5f5f5` / `--muted-foreground #737373` / `--accent #f5f5f5` / `--destructive #e7000b` / `--border #e5e5e5` / `--input #e5e5e5` / `--ring #a1a1a1` / `--column #f5f5f5`.
- Group tally: **A 6 · B 53 · C 22 · D 8 · needs-human-ruling 28 (22 specially listed + 6 palette primitives) = 117**.

---

## A Mergeable (semantic counterpart + roughly equivalent value)

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--popover-bg` | `#1f1f23` | `#fdfaf7` | detail palette, r7 23/16/17 capture | 20 | A | `--popover` | Values not equivalent: shadcn current dark `#171717` / light `#ffffff`; this name is warmer and brighter (`#1f1f23`). Which value wins (pacman value overrides vs keeping shadcn's) will change the popover visuals inside `components/ui` |
| `--card-bg` | `#1f1f23` | `#ffffff` | board palette, r7 capture (different from the landing token) | 3 | A | `--card` | Same as above: dark differs from `--card #171717`; light is already equivalent at `#ffffff` on both sides |
| `--code-bg` | `#27272a` | `#e7e2da` | detail palette, r7 23/16/17 | 6 | A | `--muted` | Close but not exact: dark `#27272a` vs `--muted #262626` (same-tier approximation); light differs more (`#e7e2da` warm vs `#f5f5f5` neutral). `--muted` also shares its value with `--accent`; confirm the code background is willing to share a value with the hover background |
| `--danger` | `#ca3a32` | `#ca3a32` | #71/#2 24c probe value, same in both themes; delete-project primary danger | 5 | A | `--destructive` | **Significantly non-equivalent value**: shadcn dark `#ff6467` / light `#e7000b`; this name is a deep red `#ca3a32`. Semantically matched but hue/lightness are entirely different — who wins needs a ruling |
| `--stop` | `#dd524c` | `#dd524c` | same value in both themes (the danger family alongside `--danger`) | 7 (+1 TW shorthand) | A | `--destructive` | Same as `--danger`; and both `--danger`/`--stop` map to one official name = **one-to-many names**, one of the two must be demoted to an alias (who stays and who is demoted needs a ruling) |
| `--text-on-accent` | `#ffffff` | `#ffffff` | on-accent text: white text over the solid backgrounds of `--card-button`/`--danger`/`--stop`, same in both themes; previously 31 scattered `#ffffff` writes centralized into this single source | 16 | A | `--primary-foreground` (or `--accent-foreground` / `--destructive-foreground`, pick one or share) | This name is a **single white ink shared across three families**; officially each family has its own foreground. Merging = one name splitting into several (or keep the single source with each official name aliasing back to it); the split needs a ruling; the same-value-in-both-themes property differs from the official `--destructive-foreground #fafafa` |

---

## B Fill-in families (in-domain colors with no counterpart in the official vocabulary — keep the original names, values follow the canonical file)

> Criterion: these are **in-domain semantics** (board columns / chip / tile / diff / chief / dialog / range / seg / tab / row / pill / notify / avatar / toggle, etc.); the official Base UI vocabulary has no corresponding slots; `shadcn.css` has a precedent of filling in only three names — `--column`/`--sidebar-hover`/`--sidebar-active`. Keeping the original names preserves their semantic precision (merging into official names would lose the in-domain distinctions).

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--agent-avatar-bg` | `#202733` | `#eff1f5` | team agent avatar plate (r7 12 light / r2 32); dark value [inference], derived from the chip-idle/plan dark family | 1 | B | — (fill-in: avatar) | No official slot; dark is an [inference] value |
| `--badge-done` | `#5ec26a` | `#5ec26a` | status-badge done green, same value in both themes | 2 (+1 TW shorthand) | B | — (fill-in: badge) | None |
| `--badge-idle` | `#9ea3ae` | `#9ea3ae` | fresh-card owner badge (r7 22/22d), same gray in both themes | 1 (+1 TW shorthand) | B | — (fill-in: badge) | None |
| `--chief-tab-active` | `#3f3f46` | `#f7f4ef` | chief tab-bar active pill (r5 101; dark [inference], r2 16 dark panel) | 1 | B | — (fill-in: tab) | dark [inference] |
| `--chief-tab-bg` | `#27272a` | `#eeeae4` | chief tab-bar group bg (r5 101) | 1 | B | — (fill-in: tab) | dark [inference] |
| `--chip-confirm-bg` | `#33221b` | `#fffbed` | chip family: pending confirm (r7 23/16/17) | 3 | B | — (fill-in: chip) | None |
| `--chip-confirm-fg` | `#f2c24b` | `#a85923` | same, fg | 3 | B | — (fill-in: chip) | None |
| `--chip-done-bg` | `#14291c` | `#ecfdf3` | chip family: done | 3 | B | — (fill-in: chip) | None |
| `--chip-done-fg` | `#5ec26a` | `#15803d` | same, fg | 3 | B | — (fill-in: chip) | None |
| `--chip-failed-bg` | `#351c1a` | `#fcf3f2` | r8 dynamic states (#75) failed chip; light measured, dark [inference] (r8 §5 dark dynamic surface not captured) | 1 | B | — (fill-in: chip) | dark [inference] |
| `--chip-failed-fg` | `#dd524c` | `#ca3a32` | same, fg | 1 | B | — (fill-in: chip) | dark [inference] |
| `--chip-idle-bg` | `#202733` | `#f3f4f6` | chip family: idle, not started (r7 23/16/17) | 3 | B | — (fill-in: chip) | None |
| `--chip-idle-fg` | `#9ea3ae` | `#4d5562` | same, fg | 3 | B | — (fill-in: chip) | None |
| `--chip-plan-bg` | `#1c2740` | `#eff2fe` | chip family: in-progress plan (r7 23/16/17) | 5 | B | — (fill-in: chip) | None |
| `--chip-plan-fg` | `#8b93f8` | `#4e47dd` | same, fg | 6 | B | — (fill-in: chip) | None |
| `--col-bg` | `#09090b` | `#f1ede7` | board palette, r7 capture sampling | 2 | B | — (fill-in: col) | None; dark same value as `--surface-inset` dark `#09090b` |
| `--col-dot-building` | `#4e81ee` | `#4e81ee` | column-dot family #351 4-fold: building in progress | 1 | B | — (fill-in: col) | None |
| `--col-dot-confirm` | `#e9a23b` | `#e9a23b` | column-dot family: pending confirm | 1 | B | — (fill-in: col) | Same value `#e9a23b` as `--badge-attention` |
| `--col-dot-done` | `#5ec26a` | `#5ec26a` | column-dot family: done | 3 | B | — (fill-in: col) | Dark same value `#5ec26a` as `--badge-done`/`--chip-done-fg` |
| `--col-dot-idle` | `#9ea3ae` | `#9ea3ae` | column-dot family #351 4-fold: idle, not started | 1 | B | — (fill-in: col) | Dark same value as `--badge-idle`/`--chip-idle-fg` |
| `--col-head-text` | `#bebec1` | `#57534e` | column header text | 1 | B | — (fill-in: col) | None |
| `--dash-border` | `#3f3f46` | `#e8e2db` | resources surface (r7 06–10, #69): dashed add-machine border; dark [inference] | 2 | B | — (fill-in: dash/resources surface) | dark [inference] |
| `--dialog-bg` | `#1f1f23` | `#fdfaf7` | modal dialog panel fill (#68, r8 78–81 dark capture) | 3 | B | — (fill-in: dialog) | Dark same value as `--popover-bg`/`--surface-elevated`; light `#fdfaf7` close to `--popover-bg` |
| `--dialog-box-bg` | `#1f1f23` | `#f1ede7` | dialog embedded box fill (r8 79 scan: panel fill + outline only) | 1 | B | — (fill-in: dialog) | Dark same value as `--dialog-bg` |
| `--dialog-ring` | `#44444b` | `#cbc8c4` | run-history row ring (r7 32 scan) / overlay hairline ring | 1 | B | — (fill-in: dialog) | Light measured (r7 32), dark has no capture note |
| `--dialog-row-bg` | `#27272a` | `#f1ede7` | r8 rerun-dialog agent row (#75) | 2 | B | — (fill-in: dialog/row) | dark [inference] |
| `--diff-add-bg` | `#16281d` | `#eaf1e8` | diff pane added-line tint (r7 27d dark measured) | 1 | B | — (fill-in: diff) | None |
| `--diff-add-fg` | `#478266` | `#499771` | diff pane stat/gutter green (r7 27/27b) | 3 | B | — (fill-in: diff) | None |
| `--diff-del-bg` | `#2e1c1a` | `#f8e6e4` | r8 deleted-line tint (#75); light measured, dark [inference] | 1 | B | — (fill-in: diff) | dark [inference] |
| `--fail-fg` | `#d98b4a` | `#cc7c2e` | r8 fail-message heading color (#75); dark [inference] | 2 | B | — (fill-in: status) | dark [inference] |
| `--menu-icon` | `#71717a` | `#1c1917` | more-menu row icon color (r8 78/56 probe) | 1 | B | — (fill-in: menu) | None |
| `--notify-icon-bg` | `#2e2f42` | `#e3dfe7` | notification-banner bell plate (#114, r2 28 dark / r2 01 light); the glyph on the plate uses `--indigo-500` | 1 | B | — (fill-in: notify) | None |
| `--overlay-divider` | `#2a2a2e` | `#efebe5` | overlay batch B (#67) popover divider; dark no capture (r7 §6), [inference] from the surface ramp | 1 | B | — (fill-in: overlay) | dark [inference] |
| `--overlay-scrim` | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | overlay scrim (track A #A2): unified fullscreen black veil for modal/search/token-gate; previously written inline at 6 places | 6 | B | — (fill-in: overlay/scrim) | No official scrim slot; same value in both themes |
| `--overlay-select-indigo` | `#2a2740` | `#edebf6` | overlay batch B: indigo select block (r7 05/05b/19); dark [inference] | 1 | B | — (fill-in: overlay) | dark [inference] |
| `--pill-idle-bg` | `#27272a` | `#e7e2da` | resources-surface status pill background (r7 06–10, #69); dark [inference] | 1 | B | — (fill-in: pill) | dark [inference] |
| `--primary-disabled` | `#3d3a8f` | `#a49fe8` | disabled primary (r8 79 light measured); dark [inference], the indigo family darkened | 2 | B | — (fill-in: disabled state) | No official disabled slot; dark [inference] |
| `--project-avatar-bg` | `#e97b35` | not mirrored (same as dark) | project initial-letter avatar background (board card / sidebar / overlays), same value in both themes | 5 | B | — (fill-in: avatar) | None |
| `--project-avatar-fg` | `#ffffff` | not mirrored (same as dark) | same, fg | 5 | B | — (fill-in: avatar) | None |
| `--range-chip-bg` | `#27272a` | `#eeebe7` | r8 range chip (#75); light measured, dark [inference] | 1 | B | — (fill-in: range) | dark [inference] |
| `--range-chip-border` | `#3f3f46` | `#d1cdc9` | same, border | 1 | B | — (fill-in: range) | dark [inference] |
| `--row-icon-bg` | `#3f3f46` | `#e7e2da` | overlay batch B: search-result icon tile (r7 05/05b/19); dark [inference] | 1 | B | — (fill-in: row) | dark [inference] |
| `--row-selected` | `#27272a` | `#f1ede7` | overlay batch B: selected row tile; dark [inference] | 2 | B | — (fill-in: row) | dark [inference]; light same value as `--surface-secondary` light `#f1ede7` |
| `--seg-active` | `#3f3f46` | `#e7e2da` | segmented-control active chip (#138 family) | 4 | B | — (fill-in: seg) | None |
| `--seg-hover` | `rgb(255 255 255 / 0.05)` | `rgb(28 25 23 / 0.05)` | segmented-control unselected hover tint (#138 dogfood, first tier of the cds alpha ladder) | 5 | B | — (fill-in: seg) | Alpha notation, same value and form as `--sidebar-hover` |
| `--tab-chip-bg` | `#27272a` | `#faf7f3` | text-tab chip: group bg = `--surface-secondary`, active chip differs (r2 24b/24c) | 6 | B | — (fill-in: tab) | Light `#faf7f3` same value as `--surface` light; e2e `segmented-controls.spec.ts:25` pins dark `rgb(39, 39, 42)` |
| `--tile-hero-bg` | `#33221b` | `#f8ead8` | resources-surface hero tile tint (r7 06–10, #69); dark [inference] | 1 | B | — (fill-in: tile) | dark [inference]; dark same value as `--tile-orange-bg`/`--chip-confirm-bg` `#33221b` |
| `--tile-indigo-bg` | `#1c2740` | `#e3dfe7` | resources-surface indigo tile background; dark [inference] | 1 | B | — (fill-in: tile) | dark [inference]; dark same value as `--chip-plan-bg` |
| `--tile-indigo-fg` | `#8b93f8` | `#6466e9` | same, fg | 1 | B | — (fill-in: tile) | dark same value as `--chip-plan-fg` |
| `--tile-orange-bg` | `#33221b` | `#f0e5d5` | resources-surface orange tile background; dark [inference] | 1 | B | — (fill-in: tile) | dark [inference] |
| `--tile-orange-fg` | `#f2c24b` | `#e9a23b` | same, fg | 3 | B | — (fill-in: tile) | dark same value as `--chip-confirm-fg` |
| `--toggle-knob` | `#ffffff` | `#ffffff` | toggle white knob (track A #A2): 12/16px white disc, same color in both themes | 4 | B | — (fill-in: toggle) | None |
| `--toggle-track` | `#27272a` | `#e7e2da` | modal dialog closed-state toggle track (#68, r8 78–81) | 1 | B | — (fill-in: toggle) | None |

---

## C Non-color (not in the color merge)

> Criterion: the type of these values is not a color (time/easing/length/font stack/composite box-shadow+ring/radius), and the official color vocabulary **has no** corresponding slots. **Not in the color merge**; if they are ever folded in, the destinations are the official `--radius` (radius) or a separate non-color layer — both belong to another ticket's scope.

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--dur-fast` | `150ms` | not mirrored | motion registry (#73): 150ms standard step | 10 | C (motion) | non-color, no official slot | None |
| `--dur-overlay` | `200ms` | not mirrored | motion registry: 200ms mount fade | 2 | C (motion) | non-color, no official slot | None |
| `--dur-drawer` | `300ms` | not mirrored | motion registry: 300ms drawer slide | 2 | C (motion) | non-color, no official slot | None |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | not mirrored | Tailwind default easing | 7 | C (motion) | non-color, no official slot | None |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | not mirrored | Tailwind ease-out | 2 | C (motion) | non-color, no official slot | None |
| `--ease-pop` | `cubic-bezier(0.22, 1, 0.36, 1)` | not mirrored | the only custom easing of the official sheet | 4 | C (motion) | non-color, no official slot | None |
| `--space-1` | `4px` | `4px` | spacing ladder (DESIGN.md §Layout & Spacing): 4px base ladder, for newly written code only | 0 | C (spacing) | non-color, no official slot | **0 references (see section D)** |
| `--space-2` | `8px` | `8px` | same | 0 | C (spacing) | non-color, no official slot | **0 references (see section D)** |
| `--space-3` | `12px` | `12px` | same | 0 | C (spacing) | non-color, no official slot | **0 references (see section D)** |
| `--space-4` | `16px` | `16px` | same | 0 | C (spacing) | non-color, no official slot | **0 references (see section D)** |
| `--space-6` | `24px` | `24px` | same | 0 | C (spacing) | non-color, no official slot | **0 references (see section D)** |
| `--font-sans` | `var(--font-inter), -apple-system, …` | not mirrored | font stack, from the 859B font stylesheet (fonts.css, r1 §4.1) | 4 | C (font) | non-color, no official slot | Depends on `--font-inter`, which is not defined in this file (see the note at the end) |
| `--font-mono` | `ui-monospace, "JetBrains Mono", …` | not mirrored | same | 20 | C (font) | non-color, no official slot | None |
| `--edge-ring` | alias → `inset 0 0 0 1px var(--border-default)` | not mirrored (follows `--border-default`) | unified border language (#139): single-source hairline ring for elevated surfaces, using inset shadow spread instead of a real border (a real 1px border rasterizes unevenly at fractional scales) | 4 | C (composite/ring) | non-color, no official slot | It is an **alias**, following `--border-default`; if `--border-default` changes to `--border` (alpha), the ring's look changes with it |
| `--edge-shadow` | `0 5px 14px rgb(0 0 0 / 0.4)` | `0 5px 14px rgb(28 25 23 / 0.14)` | #139 edge-shadow tier, single source | 4 | C (shadow) | non-color, no official slot | Light already darkened with the warm ink |
| `--fab-shadow` | alias → `var(--edge-shadow)` | not mirrored | #139 edge-shadow tier alias, single source for elevated surfaces (fab/popover/panel) | 19 | C (shadow) | non-color, no official slot | Alias, follows `--edge-shadow` |
| `--card-shadow` | `0 2px 4px rgb(0 0 0 / 0.2)` | `0 2px 4px rgb(28 25 23 / 0.07)` | card-tier resting shadow (#161): small-card family resting state, one tier below popover | 2 | C (shadow) | non-color, no official slot | None |
| `--lift-shadow` | `0 3px 12px rgb(0 0 0 / 0.5)` | `0 3px 12px rgb(28 25 23 / 0.16)` | lift-tier shadow (#391): DragOverlay flying state, above the popover tier | 1 | C (shadow) | non-color, no official slot | None |
| `--dialog-shadow` | `0 5px 14px rgb(0 0 0 / 0.4)` | `0 5px 14px rgb(0 0 0 / 0.4)` | overlay batch A (#66): dialog shadow, stronger than `--fab-shadow`; same value in both themes (explicitly mirrored) | 3 | C (shadow) | non-color, no official slot | dark same value as `--edge-shadow` dark |
| `--chief-shadow` | `0 4px 24px rgb(0 0 0 / 0.35)` | `0 4px 24px rgb(28 25 23 / 0.16)` | chief surface (r5 100–104, #72) drawer shadow, sampled from the r5 100 edge gradient | 2 | C (shadow) | non-color, no official slot | dark has no capture note |
| `--edge-radius` | `12px` | not mirrored | #139 unified 12px radius (elevated surfaces) | 10 | C (radius) | non-color; the official radius slot is `--radius` (`shadcn.css` already defines `0.625rem` = 10px) | **Different value from the official `--radius`** (12 vs 10); there is also `--radius-popover` at 10px. A three-way merge first needs a ruling on "which tier is the official `--radius`" |
| `--radius-popover` | `10px` | `10px` | popover radius | 18 | C (radius) | non-color; official `--radius` (10px, equal to `shadcn.css`'s current value) | The value happens to equal the official `--radius`; a merge candidate, but semantically it belongs to the geometry (non-color) layer |

---

## D Dead tokens (0 references under the specified caliber — cleanup candidates)

> Caliber = the task-specified grep, scope `apps/web/src`. **Watch for two "look dead but are not" cases**, marked per row.

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--active-text` | `#a0a0a5` | `#6e6b69` | No adjacent comment (:root line 22, right after the motion-registry comment block) | 0 | D | — (no official slot) | Defined only in tokens.css itself repo-wide, no consumption point anywhere; the semantics are only guessable from the name (`needs human ruling`: possibly a former active-state text color). `--disabled-fg` dark shares the value `#a0a0a5` |
| `--badge-attention` | `#e9a23b` | `#e9a23b` | status-badge pending orange (board palette family) | 0 (**but 1 TW shorthand**: `todo-card.tsx:114` uses `bg-(--badge-attention)`) | D→**B** (actually not dead) | — (fill-in: badge) | **Not a dead token**: the specified grep misses the Tailwind v4 shorthand. Before cleanup, a supplementary scan of `bg-(--x)` forms is mandatory |
| `--card-ghost-border` | alias → `var(--card-border)` | alias → `var(--card-border)` | A6 takeover, ghost single source: the alias directly references `--card-border`, aligned with the overlay-btn measurement | 0 (**comment references only**: `ui/button.css:47`, `detail/detail.css:1622` both say in comments "the alias is kept for historical consumers") | D (alias residue) | delete after merging into `--border`/`--card-border` | **Truly dead**: no `var()` consumption, only doc comments remain. Per No Negative Echo, the comment "kept for historical consumers" is itself abandoned residue |
| `--chip-active-bg` | `#26243a` | `#ebe8f2` | r2 32 selected-feedback chip tint (#70); dark value [inference] | 0 | D | — (fill-in: chip) | dark [inference]; no consumption point |
| `--chip-active-border` | `#3b3866` | `#cdc9f0` | same, chip outline | 0 | D | — (fill-in: chip) | dark [inference]; no consumption point |
| `--disabled-fg` | `#a0a0a5` | `#ffffff` | disabled primary label + more-menu row icon (r8 78/56 probe) | 0 | D | — (fill-in: disabled state) | No consumption point; dark same value as `--active-text` `#a0a0a5`, light same value as `--text-on-accent`/`--toggle-knob` `#ffffff` |
| `--nav-bg` | `rgba(24, 24, 27, 0.85)` | `rgba(250, 250, 249, 0.85)` | No adjacent comment (:root line 35); the same string also exists elsewhere repo-wide at `docs/research/assets/r1/…css` (not consumption) | 0 | D | — (no official slot) | Truly dead: zero consumption in `apps/web/src` |
| `--send-disabled` | `#454690` | `#9f9ae2` | send-button disabled state; [inference] indigo-500 at 55% over `--surface-secondary` | 0 | D | — (fill-in: disabled state) | dark marked as [inference]; no consumption point |

**Other 0-reference names (already listed in other sections; cross-indexed here to avoid double counting)**: `--blue-400` (needs-human-ruling · palette), `--indigo-400` (needs-human-ruling · indigo family), `--sidebar-bg` (needs-human-ruling · sidebar family), `--sidebar-selected` (needs-human-ruling · sidebar family), `--space-1` … `--space-6` (section C).

**The #409-reported 19 vs the measured 17 discrepancy**: under the specified caliber (`var(--x)` form, `apps/web/src`), the measured 0-reference names are **17**: `--active-text`, `--badge-attention`, `--blue-400`, `--card-ghost-border`, `--chip-active-bg`, `--chip-active-border`, `--disabled-fg`, `--indigo-400`, `--nav-bg`, `--send-disabled`, `--sidebar-bg`, `--sidebar-selected`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6`. The discrepancy may come from: (a) #409 measured at a different point in time from this file (new names added / old consumers migrated in between); (b) a different counting caliber (whether `.light` mirror lines are included, whether Tailwind shorthands are included). **`--badge-attention` has 1 live consumption point via the shorthand caliber and must not be counted as a dead token.**

---

## Needs human ruling

### I. Specially listed (known pitfalls — evidence given per item, no preset conclusions)

#### 1. `--border-default` / `--border-strong` / `--card-border` against the official `border` (**type-change risk**)

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--border-default` | `#27272a` | `#e2dbd1` | Core of the unified border language (#139): single-source 1px seams across shell joints; the `--edge-ring` alias references it directly; all sidebar layer separation relies on it (#390 same-base rule) | **73** (13 consuming files, spanning board/chief/detail/overlay/resources/pages/secondary — every shell) | needs ruling | `--border` | **Type change**: this name is a **solid hex** (dark `#27272a` / light `#e2dbd1`), while the official dark `--border` is **alpha** `rgb(255 255 255 / 0.1)` and light `#e5e5e5`. Solid → alpha breaks the property "a seam renders constant on any background" (a solid color renders the same over `--surface`/`--surface-secondary`/`--col-bg`; alpha varies with the base). And 73 references + the user explicitly calling it "the cross-shell seam contract" — the strongest downstream coupling surface |
| `--border-strong` | `#3f3f46` | `#cec6bb` | Strong-outline tier (same family as `--border-default`, line 34) | 7 | needs ruling | `--input` (candidate) or `--border` | The official `--input` is `rgb(255 255 255 / 0.15)` (dark) / `#e5e5e5` (light), **also an alpha type change**; this name is one tier brighter/darker than `--border-default`, and merging into a single `--border` loses the "strong tier". It shares the dark value `#3f3f46` with `--dash-border`/`--seg-active`/`--row-icon-bg`/`--chief-tab-active`/`--range-chip-border` in several places — one move disturbs many |
| `--card-border` | `#27272a` | `#e1dbd2` | board-palette card outline; the `--card-ghost-border` alias references it directly | **32** | needs ruling | `--border` (or the border face of `--card`) | **Type change**: solid → `--border` alpha. And the light value `#e1dbd2` vs `--border-default` light `#e2dbd1` are **almost but not exactly the same** (1–2 color steps apart) — a merge must first rule "which of these two near-identical values is the canonical copy"; 9 consuming files |

#### 2. The 6-tier `--surface` family against the official `background` / `card` / `secondary` / `accent` / `muted` (**tier-loss risk**)

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--surface` | `#18181b` | `#faf7f3` | main panel background (DESIGN.md §canvas hierarchy: canvas `#09090b` → surface → secondary → tertiary); the `--sidebar-bg` alias references it directly | 41 (includes 2 alias-definition self-references) | needs ruling | `--background` | **Tier loss + non-equivalent value**: this name is tier 2 of a 6-step ramp (the main panel), while the official `--background` dark `#0a0a0a` is closer to this repo's `--surface-inset`/canvas. Merging compresses "canvas vs main panel" into one tier |
| `--surface-secondary` | `#1f1f23` | `#f1ede7` | card/overlay background (DESIGN.md); segmented-control group bg; light same value as `--row-selected`/`--dialog-row-bg` | 48 | needs ruling | `--secondary` / `--muted` / `--card`, three candidates | **Tier loss + one-to-many**: the official `--secondary` and `--muted` share the dark value `#262626` (same value by design), while this name's dark `#1f1f23` equals neither; 48 references make it the second-widest reach in the file |
| `--surface-tertiary` | `#27272a` | `#e8e2d9` | embedded-control background (DESIGN.md: the last tier of the four-step ramp); count/label backgrounds use surface-tertiary + text-secondary | 8 | needs ruling | `--accent` / `--secondary` | **Tier loss**: the official `--accent` dark `#404040` is brighter than this name; after a merge the harness's "embedded-control background" tier may have nowhere to go |
| `--surface-inset` | `#09090b` | `#f2ede6` | canvas/page base color (the first tier of DESIGN.md's canvas hierarchy); dark same value as `--col-bg` | 2 | needs ruling | `--background` | **Tier loss**: this name is the true "bottom color", and the official `--background` dark `#0a0a0a` is almost the same value as this name `#09090b` — **the only tier in the ramp whose value is equivalent to the official background**; but the light side differs a lot (`#f2ede6` warm vs `#ffffff`) |
| `--surface-elevated` | `#1f1f23` | `#fdfaf6` | elevated-surface background (:root line 27, no extended comment); light close to `--popover-bg` light `#fdfaf7` | 3 | needs ruling | `--card` / `--popover` | **Tier loss**: dark is **exactly the same value** as `--surface-secondary`/`--surface-hover` `#1f1f23` — the three tiers have already collapsed into one on the dark side; before merging, confirm whether these three names really need to exist separately |
| `--surface-hover` | `#1f1f23` | `#f2ede6` | overlay/canvas hover canon (motion.css); sidebar hover has its own `--sidebar-hover` (#128 division) | 8 (+1 TW shorthand = 9) | needs ruling | `--accent` (hover slot) | **Tier loss + non-equivalent value**: the official hover-semantics slot is `--accent` (dark `#404040`), clearly brighter than this name's dark `#1f1f23`; merging folds "overlay/canvas hover" and "accent" into one slot, and the division-of-labor comment with `--sidebar-hover` (#128) needs to be restated |

#### 3. The 4-tier `--text-primary` / `-secondary` / `-tertiary` / `-dim` against the official 2-tier `foreground` / `muted-foreground` (**tier-loss risk**)

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--text-primary` | `#fafaf9` | `#1c1917` | primary text color (no independent comment, first in the text family) | **121** (highest in the file) | needs ruling | `--foreground` | **Tier loss + non-equivalent value**: dark `#fafaf9` vs the official `--foreground` dark `#fafafa` (almost equal ✓), but light `#1c1917` vs the official `#0a0a0a` differs notably (warm ink vs pure black). 121 references = the largest merge area in the file |
| `--text-secondary` | `#d4d4d8` | `#57534e` | secondary text (DESIGN.md: used for chip fg / count label text) | 63 | needs ruling | `--muted-foreground` (candidate) | **Tier loss**: the official `--muted-foreground` dark `#a1a1a1` is clearly darker than this name `#d4d4d8` — this name is closer to a secondary variant of the official `--foreground` than to muted. When 4 tiers compress into 2, this name has nowhere to go |
| `--text-tertiary` | `#71717a` | `#78716c` | tertiary text (DESIGN.md: card-header mono 11px task IDs use text-tertiary) | **115** (second highest in the file) | needs ruling | `--muted-foreground` | **Tier loss + approximate value**: dark `#71717a` vs the official `--muted-foreground` dark `#a1a1a1` not equal; light `#78716c` vs `#737373` close. Dark same value as `--menu-icon` `#71717a` |
| `--text-dim` | `#52525b` | `#a8a29e` | the darkest text tier (no independent comment) | 95 | needs ruling | `--muted-foreground` | **Tier loss**: the darkest of the 4 tiers; the official 2 tiers have no slot for it — **if compressing 4→2, one of this tier and `--text-tertiary` must be dropped** (tiers 3 and 4 merged); which one is dropped needs to be explicit |

#### 4. The `--indigo-*` family (including `--card-button`) against the official `primary` (**non-equivalent-value risk**)

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--indigo-600` | `#4f46e5` | not mirrored (same as dark) | palette primitive (:root line 40) | 1 | needs ruling | `--primary` (candidate) | Non-equivalent value: the official neutral theme `--primary` is near-white `#e5e5e5` (dark) / near-black `#171717` (light), **entirely different in hue** (indigo vs neutral). Keeping the brand purple as primary means changing the official neutral theme's primary semantics |
| `--indigo-500` | `#6466e9` | not mirrored (same in both themes, measured r7 01b/02: task text and card buttons land on this value, not the landing `#6366f1`) | brand primary color; the glyph on `--notify-icon-bg` uses it | 26 | needs ruling | `--primary` | **Non-equivalent value** (same as `--indigo-600`); and this name is the same in dark and light (deliberately, per the comment), while the official primary is theme-inverted — merging breaks the "same color in both themes" measured property |
| `--indigo-400` | `#818cf8` | `#6366f1` | palette primitive (:root line 44) | 0 | needs ruling | `--primary` / `--ring` (candidate) | **0 references (dead)** and non-equivalent value; the official `--ring` dark `#737373` is neutral gray, which does not go with indigo |
| `--indigo-disabled` | `#4e47dd` | `#a5a1ea` | modal-dialog disabled synchronization (#68, r8 78–81) | 1 | needs ruling | no official slot (disabled state) | **Same dark value** `#4e47dd` as `--card-button` — if `--card-button` merges, this name must change with it |
| `--indigo-disabled-fg` | `#afabf0` | `#ffffff` | same, disabled label color | 1 | needs ruling | no official slot | light same value as `--text-on-accent` `#ffffff` |
| `--card-button` | `#4e47dd` | `#4e47dd` | board palette: solid card-button color (same in both themes); **pinned by e2e** | 25 | needs ruling | `--primary` | **Non-equivalent value + pinned by tests**: `apps/web/e2e/brand-typo.spec.ts:113-114` asserts `.res-back`'s `outlineColor === 'rgb(78, 71, 221)'` (= `#4e47dd`), with a comment stating "the codebase ring recipe rides --card-button (#4e47dd, both themes)"; `apps/web/e2e/overlay-focus.spec.ts:17` has the same-value constant `RING = 'rgb(78, 71, 221)'`. Merging with a changed value turns both specs red; and it is simultaneously the **focus-ring color** (ring semantics) and the **button background** (primary semantics) — one color across two semantics |

#### 5. The sidebar family (`--sidebar-bg` / `--sidebar-hover` / `--sidebar-selected`) — **same-name collision, specially listed**

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--sidebar-bg` | **alias** → `var(--surface)` | **alias** → `var(--surface)` | sidebar layer (#390 same-base rule): the sidebar and the main area **share** the surface token; layer separation is carried only by the 1px `--border-default` seam, with no color-tier step | **0** (zero consumption in `apps/web/src`; mentioned in `apps/web/DESIGN.md:102`) | needs ruling | official sidebar family `--sidebar` (one of the 8) | **Name collision + semantic mismatch**: the official `--sidebar` is "the sidebar's own background" (shadcn.css does not define it; the official default equals `--background` or an independent tier), while this repo **deliberately keeps the sidebar the same base as the main panel** (#390 same-base rule; the comment states "layer separation is carried by the seam line, not a color tier"). Mapping directly would introduce a color-tier difference this repo deliberately avoids. Also: this name has 0 references (a dead token; the alias itself has no consumer) |
| `--sidebar-hover` | `rgb(255 255 255 / 0.05)` | `rgb(28 25 23 / 0.05)` | sidebar-row hover pill (#128, referencing claude.ai's cds, 5% of the cds alpha ladder) | 2 | needs ruling | official sidebar family `--sidebar-accent` (candidate) | **Name collision (severe)**: `shadcn.css:78` already defines a same-named `--sidebar-hover: rgb(255 255 255 / 0.05)` (light `rgb(28 25 23 / 0.05)`) — **two files define the same name with the same value and the same notation**. Same-name dual sources mean whichever wins depends on import order — the most direct structural hazard of this merge (the official 8-name sidebar family has **no** `--sidebar-hover`; the official counterpart slot is `--sidebar-accent`) |
| `--sidebar-selected` | `rgb(255 255 255 / 0.1)` | `rgb(28 25 23 / 0.1)` | sidebar-row selected pill (#128, 10% of the cds alpha ladder) | 0 (mentioned only in a comment at `apps/web/e2e/sidebar-nav.spec.ts:10,127`) | needs ruling | official sidebar family `--sidebar-accent` / `--sidebar-primary` | **Name collision (variant)**: what `shadcn.css:79` defines is `--sidebar-active` (not `--sidebar-selected`), same value and same notation — **two names for the same semantics**. Neither name exists in the official 8-name family; the official counterpart slot is `--sidebar-accent`. This name has 0 references; `--sidebar-active` has 1 |

> **A structural gap of the sidebar family (not in tokens.css, but it decides the mapping caliber)**: the official sidebar family of 8 = `--sidebar` / `-foreground` / `-primary` / `-primary-foreground` / `-accent` / `-accent-foreground` / `-border` / `-ring`. This repo currently has only 3 sidebar-related names (2 are alpha pills and 1 is an alias), **missing 5–6** (no sidebar-foreground / primary / accent-foreground / border / ring). The sidebar's border/ring are currently carried by the global `--border-default` / `--card-button` (see the two risk notes above). **Fill-in families vs importing the full official 8-name sidebar family wholesale — needs a human ruling.**

### II. Other needs-human-ruling items (the palette-primitive family — the official chart-1..5 are the only color-slot family, but these names carry no chart semantics)

| Name | dark value | light value | Use (comment digest) | Consumptions | Suggested class | Target official name | Risk |
|---|---|---|---|---|---|---|---|
| `--blue-500` | `#3b82f6` | not mirrored (same as dark) | palette primitive (:root line 45); no independent use comment | 1 | needs ruling | `chart-1..5` (candidate) | The only official color-slot family is `chart-1..5`, but these names carry **no chart consumption semantics** (they are Tailwind primitives referenced sporadically). Forcing them into chart = names mismatching uses; keeping them in B = an out-of-vocabulary self-kept primitive family. One of the two needs a ruling |
| `--blue-400` | `#60a5fa` | not mirrored (same as dark) | palette primitive | 0 | needs ruling | `chart-1..5` (candidate) | **0 references (dead)** + the same semantics problem |
| `--amber-500` | `#f59e0b` | not mirrored (same as dark) | palette primitive | 1 | needs ruling | `chart-1..5` (candidate) | Same as above |
| `--green-500` | `#22c55e` | not mirrored (same as dark) | palette primitive | 1 | needs ruling | `chart-1..5` (candidate) | Same as above |
| `--rose-500` | `#f43f5e` | not mirrored (same as dark) | palette primitive | 3 | needs ruling | `chart-1..5` (candidate) | Same as above |
| `--gray-400` | `#9ca3af` | not mirrored (same as dark) | palette primitive | 1 | needs ruling | `chart-1..5` (candidate) | Same as above |

---

## Attached: other facts from the collection process (for the ruling's reference)

- **Names defined outside this file but consumed**: `--detail-pane-right` (defined at `apps/web/src/detail/detail.css:12`, value `488px`, 4 consumptions) — not among tokens.css's 117, a local token, unrelated to this merge (listed so it is not confused with the 117-name list).
- **Alias graph (where the canonical values flow)**: `--sidebar-bg → --surface`; `--card-ghost-border → --card-border`; `--fab-shadow → --edge-shadow`; `--edge-ring → --border-default` (embedded in a composite value). These 4 are **ready-made samples** of the "legacy names demoted to aliases" direction and can serve as a reference for the change pattern.
- **`--font-sans` depends on an external definition**: its value references `var(--font-inter)`, and that name is not among tokens.css's 117 (the comment says it comes from `fonts.css`, r1 §4.1). `apps/web/src` has 2 `var(--font-inter)` consumptions — that is, the name is defined elsewhere; do not misread it as a dead token when reading the tables.
- **Top 10 by consumption count** (specified caliber): `--text-primary` 121 · `--text-tertiary` 115 · `--text-dim` 95 · `--border-default` 73 · `--text-secondary` 63 · `--surface-secondary` 48 · `--surface` 41 · `--card-border` 32 · `--indigo-500` 26 · `--card-button` 25. **These 10 names account for the vast majority of the merge's change area**, and 8 of them fall in the "needs human ruling" section.
- **e2e value-pinned surfaces** (a value change in the merge turns these red locally-unnoticed, exploding only in CI): `brand-typo.spec.ts:113-114` (`--card-button` = `rgb(78, 71, 221)`) · `overlay-focus.spec.ts:17` (same-value constant) · `segmented-controls.spec.ts:25-27` (`--tab-chip-bg` in both themes + `--surface-secondary` dark = `rgb(31, 31, 35)`) · `--sidebar-hover` dual-sourced with the same value at `tokens.css:96` and `shadcn.css:78` (verified locally).

---

## Ruling (2026-09-29; the user agreed to all four items)

Four rules; the final assignment of each table row is derived from them.

- **D1 merge caliber = merge only where there is an official 1:1 counterpart; everything else goes to fill-in families to preserve tier counts.** The 6 section-A names merge (`--surface-inset` → `--background`, `--card-bg` → `--card`, `--popover-bg` → `--popover`, `--text-primary` → `--foreground`, etc.); the remaining 5 surface tiers and 3 text tiers all go to fill-in families, **no tier collapse**. Rationale: those 6 are exactly the general surfaces that `components/ui` actually consumes, where upstream isomorphism pays off; zero tier loss.
- **D2 seam solid color = all three names go to fill-in families, not merged into the official alpha `--border`.** `--border-default` (73 places / 13 files) carries the cross-shell seam contract; solid → alpha would break the property "a seam renders constant on any background". Meanwhile `--border-default` is the canonical copy and `--card-border` is demoted to an alias (the 1–2-step light-side difference between `#e1dbd2` and `#e2dbd1` is dissolved this way); `--border-strong` stands on its own.
- **D3 brand purple = `--primary` keeps the official neutral, and the whole `--indigo-*` family goes to fill-in families.** Also split `--card-button`'s one-color-two-semantics (focus-ring color vs card-button background, "same value, separate names") — it is pinned by both `brand-typo.spec.ts:113-114` and `overlay-focus.spec.ts:17`.
- **D4 sidebar family = do not import the official 8-name family wholesale; keep the existing 3 names in fill-in families + dedup.** Per this repo's #390 same-base rule: the sidebar and the main panel are deliberately the same base, layer separation is carried only by the 1px seam, while the official `--sidebar` is an independent color tier. Two dedup lines: `--sidebar-selected` (tokens) and `--sidebar-active` (shadcn), two names for the same semantics, collapse into one; `--sidebar-hover` is dual-sourced (`tokens.css:96` / `shadcn.css:78`) and collapses to a single canonical location.
- **D5 dead tokens = clean up the measured 17** (except `--badge-attention`, which has a live TW-shorthand consumption). Before cleanup, run one supplementary scan under the `bg-(--x)` shorthand caliber to avoid deleting by mistake.

**Net result**: of the 117 names, 6 merge, about 60 go to fill-in families (the original 53 plus those absorbed by D2/D3/D4), 22 are non-color, 17 are cleaned up. The value canonical copy takes the form "official general names + in-repo fill-in names coexisting"; `tokens.css` is demoted to an alias table (not deleted — 1004 references still point at these names).

**Next steps (execution surface, out of this audit)**: rewrite the value canonical copy per the assignments above, land `tokens.css` as aliases, clean up the 17 dead tokens, then a one-time visual re-baseline (caliber belongs to #411).
- **Coverage check**: A 6 + B 53 + C 22 + D 8 + needs-human-ruling 28 (22 specially listed + 6 palette primitives) = **117** ✓ (= the 117 in the task statement; nothing missing, nothing double-counted).

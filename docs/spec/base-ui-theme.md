# Base UI theme: black-and-white skeleton + hand-made motion + Herdr purple (V2 direction landing in the repo)

> Status: spec awaiting construction. Predecessor voided ticket #782 (recolor-only, no geometry change, scope written wrong, closed by the user).
> The user's words (2026-10-04, consistent three times): the V2 direction is a black-and-white skeleton plus hand-made motion plus a theme color, not just swapping a color.
> The theme color uses that Herdr pair of purples: light on beige paper with deep purple, dark on warm black with light purple.
> Canonical input material: `library/t-accent-prototype/` (README + `accent-compare-prototype.html` + `HERDR-THEME-TOKENS.md`, pulled directly from herdr.dev CSS on 2026-10-04) and `library/t-0068-prototype/` (source of the V2 skeleton and motion, the canonical Base UI docs demo).
> This spec only answers "what it looks like when landed in the repo"; the construction/acceptance ticket split is in §6.

## 0. Failure-mode list (list first, then construct — repo discipline)

Before touching anything, the execution ticket must first write the corresponding failure modes into that ticket's acceptance-veto items:

| # | Failure mode | Guardrail |
|---|---|---|
| F1 | Token values flip but the visual-spec baseline is not reshot: the whole site's visual specs go red, the implementer blindly runs `--update-snapshots` line by line, laundering real regressions into the new baseline | Every PR with visual changes first posts the affected-spec list; run `e2e:affected` once before and once after reshooting; explain the diff line by line (see §5.3) |
| F2 | Dark-mode destructive ships with white text: `#ffffff` on `#e05a5a` measures only 3.63:1 | `--destructive-foreground` on the dark side must be dark text (§2.1); the T-accept contrast gate retests every pair |
| F3 | Light-mode pick selected row ships with light-purple text per the prototype's 14% tint: measures 3.50:1, far below 4.5 | The light-side selected pair uses §2.5's deepened-purple scheme (4.59:1); copying the prototype value verbatim is forbidden |
| F4 | herdr `faint` family used as body-text color: the light side's `#86826f` is only 3.27:1 on paper | faint/faint2 may only be decorative in this repo (borders, placeholders, non-text icons); the body-text ramp keeps the deliberate deviation of §2.4 |
| F5 | Hand-made motion fights the tw defaults: the same popover runs `animate-in` and a hand-written keyframe at once, entry/exit stacking doubled | Hand-made work may only land as "override values" on already-migrated surfaces (§1.2); one mechanism per surface, grep-verifiable |
| F6 | Radius-zeroing silently breaks geometry pins: checkbox 18px→16px, popover radius 10px→0, and `checkbox-unified` / `visual-polish` assertions quietly die | Every skeleton PR lists the geometry assertions it touches and updates them in sync; changing CSS without changing spec is forbidden (§5.2) |
| F7 | State colors collide with the new spot hue: somewhere outside chip-plan uses purple as both brand and state, and the user cannot tell "clickable" from "planned" | The 15° rule (§2.5): slots within ±15° of spot's hue all go back to the spot family; the other state colors stay |
| F8 | Theme switch smears the whole page: transitions on color/background/border/shadow all fire at once when `.light` flips | Any PR touching token values must carry theme-switch suppression (better-ui recipe: `transition:none` + reflow + restore next frame), covered by `theme-toggle.spec` |
| F9 | The fixture baseline photographs another lane's stack: `reuseExistingServer` + port collision makes the evidence shoot someone else's build | Re-check the port with `lsof` right before starting (a proven precedent); on collision switch ports and rerun; that round's results are void |

## 1. Scope: three pieces, each to what depth

### 1.1 Skeleton: which surfaces switch from the current to the black-and-white skeleton

The skeleton = the V2 prototype's `html[data-v="v2"]` geometry and structural language; prototype line numbers refer to `accent-compare-prototype.html`. Two batches: the first is what the prototype has pinned down; the second is the same direction, with values to be measured by surface tickets:

First batch (prototype has exact values; land directly):

- Checkbox tile: 18px square with 4px radius → **16px, radius 0, 1px ink border** (prototype L321–329). Off state: transparent fill (panel-color fill) + ink border; on state: solid theme-color fill + theme-color check glyph (prototype L337–341, the H tier being theme-color fill, not a black-white inversion). Hover on the unchecked box outlines it to hint clickability (L342). The current `checkbox.css` semantics of `--card-button` solid fill + white check are kept; only the values and geometry change.
- Buttons: height 32px, radius 0, 14px/400 (L344–352). Primary: theme-color solid fill + theme-color text, hover `brightness(1.07)` (L365, no opacity drop); secondary: panel fill + ink border, hover goes through the hover token, press through the active token (L353–359).
- Popover shell: 12px inner padding, 1px ink border, radius 0, 8px top anchor offset, min width 220px (the current 220px popover width unchanged, L373–380), with a 12×6 outlined Arrow (prototype L371).
- Row hover: always follows the theme color — rows and more-buttons take a light theme-color tint (`accent-soft` = `color-mix(in srgb, spot 14%, transparent)`, prototype L103), the primary button stays solid; delete rows take a light danger tint (prototype README §operations).

Second batch (same direction; values re-measured by surface tickets using the prototype's method, no guessing):

- Board cards, sidebar rows, the chief drawer, the detail surface, pages surfaces: the skeleton language is uniform (ink border, square corners, theme-color hover tint), but these surfaces' geometry is pinned by e2e geometry assertions (18px tile, 220px popover, 12px radius, etc.), so migrate surface by surface + re-review the pins surface by surface.
- The user's words already accepted decoupling from todos.dev (the t-0068 README's cost list: abandoning replication and pixel discipline). Geometry pinning does not freeze changes; it means changing them must update the assertions in sync (F6).

Surfaces not touched: the `--radius` base and card radii do not move in the first batch; board column-width tokens, the z ladder, and the font stack are out of this spec's scope.

### 1.2 Motion: what is hand-made, and the relationship with motion.css / ADR 0009

State the relationship first, then the hand-made list.

**The relationship in one sentence: hand-made motion is a bounded override of ADR 0009's default tier on migrated surfaces, not a second system.**
ADR 0009 (direction B, site-wide entry/exit converges on shadcn/tw-animate-css defaults) stays in force: unmigrated surfaces keep everything as is (dialog `zoom-in-95`, dropdown/popover `duration-100` + slide -8px, mount fade-in at the tw default tier, the ADR D3 retroactively-approved values unchanged). On migrated surfaces, the **values** that conflict with the V2 skeleton are swapped for the prototype's exact values; the mechanism stays single-set (transition semantics, interruptible mid-flight, the better-ui rule), coexisting with motion.css's D4 preserved surfaces (tab indicator slide, hover/press tint, the `prefers-reduced-motion` site-wide downgrade rule). Acceptance form: one mechanism per surface — any migrated surface where grep finds `animate-in` and a hand-written keyframe coexisting goes red (F5).

Hand-made list (all from the prototype, with exact values; the production form of the transition code is decided by surface tickets, per the better-ui rule: interaction-state changes use transition, not one-shot keyframes):

- Check entrance: background 100ms ease-out inversion + check scale .5→1 with a slight overshoot at 140ms, curve `cubic-bezier(0.34, 1.4, 0.64, 1)` (prototype L796); uncheck: check shrinks out at 90ms + background flips back at 100ms (L802–806). Checkbox-row press: tile scales to 0.92, 80ms ease-out (L330).
- Popover enter/exit: scale .98 + fade, 100ms ease-out, origin follows the anchor (L371, the canonical Base UI docs value). On migrated overlay surfaces it **replaces** ADR D3's slide -8px.
- Focus ring: 2px solid + offset 2 (checkbox tile, L331–334; following the repo's #388 family rule, color swapped to the new `--focus-ring` value); the in-popover button ring offset -1 (L366–368).
- Theme-switch suppression: the skin-swap PR must carry it (better-ui recipe: inject `transition:none` + reflow + restore next frame), F8.

"Motion is not given by Base UI" still holds (t-0068 README §facts): the library only gives the `data-open` / `data-starting-style` / `data-ending-style` hooks; the CSS is all hand-written. This repo's checkbox is already on the Base UI official component (#690), the hooks exist, and the hand-made values drop straight on.

Motion evidence follows the existing GIF discipline (user decided 2026-10-03: motion-class changes' acceptance evidence must include a GIF, one before/after each; method copied from t-0041: animation fully paused + manual scrub with `__motionScrub(t)` → frame-by-frame screenshots → ffmpeg assembly; the PR body embeds via raw permanent links). Static images are supplementary only.

### 1.3 Theme color: which tokens the Herdr purple enters, using the H-tier exact values

Only the H tier (Herdr true values); the A–D custom tiers are prototype process assets, not landed:

- Light: paper `#efece5` + primary-button purple `#8839ef` + white text (5.41:1, re-measurement consistent).
- Dark: warm-black background `#17171a` + primary-button purple `#cba6f7` + dark text `#17171a` (8.81:1, re-measurement consistent; the prototype says 8.8, the re-measure 8.81, the re-measured value adopted).

Purple enters only three slot classes (prototype README §what the tiers are: the primary action button "Done" and the checked checkbox; borders/text/shadows stay black-and-white):

1. Primary-action solid fill: `--card-button` (light `#8839ef` / dark `#cba6f7`).
2. Focus ring: `--focus-ring` (the same two values; the current same-value relationship with `--card-button` is kept).
3. Checked-tile fill + selected-row text: through the `--brand` / `--brand-fg` semantics (derivation rules in §2.5).

danger starts a separate red family (the prototype already fixed the old V2 "danger takes white" defect): light `#c73e3e`, dark `#e05a5a`, both herdr true values. Note the dark-side red fill **must not take white text** (3.63:1, F2); `--destructive-foreground` flips to dark text on the dark side, see §2.1.

The `--spot-ink` semantics (the herdr site proper: light takes white text / dark takes background-colored text) are carried by `--text-on-accent`: light `#ffffff`, dark `#17171a`.

## 2. Token mapping table: prototype values → repo slots

Notation: one slot per row, sources tagged in three tiers — [true value] (the herdr.dev site's mode layer or the prototype's exact value, adopted verbatim), [derived] (computed per this section's rules, with the measured contrast attached), [kept] (current value unchanged, with the reason). Every slot tagged [derived]/[kept] must still be re-measured by the surface ticket per §5.1 before it counts as landed.

The theme mechanism is unchanged: `:root` = dark default, root element `.light` = light mirror (`theme.ts`, localStorage `pacman-theme` + `data-theme` mirror); notation stays hex/rgb (shadcn.css header note: the e2e value probes parse rgb).

### 2.1 Official semantic slots (the `--background` family + `--primary` family + `--destructive` family)

Dark side (`:root`):

| Slot | New value | Source |
|---|---|---|
| `--background` | `#17171a` | [true value] ink bg |
| `--foreground` | `#eae8ee` | [true value] ink |
| `--card` / `--popover` | `#1e1e22` | [true value] panel/pop |
| `--card-foreground` / `--popover-foreground` | `#eae8ee` | [true value] |
| `--primary` / `--primary-foreground` | `#e5e5e5` / `#171717` | [kept] neutral solid-fill role; V2 has no counterpart; not a brand slot |
| `--secondary` / `--secondary-foreground` | `#26262b` / `#eae8ee` | [true value] line color doubling as sedentary fill |
| `--muted` | `#26262b` | [true value] mass |
| `--muted-foreground` | `#b0afb6` | [true value] faint, 8.22:1, body text passes |
| `--accent` / `--accent-foreground` | `#26262b` / `#eae8ee` | [true value] prototype hover |
| `--destructive` | `#e05a5a` | [true value] H dark red |
| `--destructive-foreground` | `#17171a` | [derived] 4.92:1; white text is only 3.63:1, **the dark side must flip to dark** (F2). The current convention of white text in both themes breaks here |
| `--border` | `#26262b` | [true value] line, alpha notation made solid |
| `--input` | `#35353d` | [true value] line2 |
| `--ring` | `#908f96` | [derived] faint2, 5.58:1, the ring passes at the 3:1 acceptance bar |

Light side (`.light`):

| Slot | New value | Source |
|---|---|---|
| `--background` | `#efece5` | [true value] paper |
| `--foreground` | `#15140f` | [true value] ink |
| `--card` / `--popover` | `#e7e3da` | [true value] panel/pop (card and paper differ by one tier, same trade as the herdr site proper) |
| `--card-foreground` / `--popover-foreground` | `#15140f` | [true value] |
| `--primary` / `--primary-foreground` | `#171717` / `#fafafa` | [kept] same reason as the dark side |
| `--secondary` / `--secondary-foreground` | `#e7e3da` / `#15140f` | [true value] panel |
| `--muted` | `#ddd8cc` | [true value] mass |
| `--muted-foreground` | `#55534a` | [true value] dim, 6.54:1 |
| `--accent` / `--accent-foreground` | `#e2ded4` / `#15140f` | [true value] prototype hover |
| `--destructive` | `#c73e3e` | [true value] H light red |
| `--destructive-foreground` | `#ffffff` | [derived] 5.02:1 |
| `--border` | `#e2ded4` | [true value] line |
| `--input` | `#cbc5b6` | [true value] line2 |
| `--ring` | `#86826f` | [derived] faint, 3.27:1 — the ring barely passes the 3:1 acceptance; the surface ticket re-measures, and if it fails, falls back to dim (F4-related) |

### 2.2 surface / text / seam-line families (the gap-filling family, compressed same-source)

herdr's neutral ladder has only three tiers (background/panel/mass) plus two line tiers; the current five-tier surface ramp compresses accordingly, with the surplus tiers becoming aliases — inventing a fourth gray tier is forbidden:

| Slot | Dark | Light | Source |
|---|---|---|---|
| `--surface` | `#1e1e22` | `#e7e3da` | [true value] panel |
| `--surface-secondary` | `#26262b` | `#ddd8cc` | [true value] dark=line doubling as fill / light=mass |
| `--surface-tertiary` | `#35353d` | `#ddd8cc` (alias, same value as secondary) | [true value] dark=prototype active / light=herdr has no fourth tier, tiers merged |
| `--surface-elevated` | `#1e1e22` (alias, same value as surface) | `#e7e3da` (alias) | tiers merged, same reason as above |
| `--surface-hover` | `#26262b` | `#e2ded4` | [true value] the prototype's two hover values |
| `--surface-press` | `#35353d` | `#ddd8cc` | [true value] the prototype's two active values |
| `--column` / `--col-bg` | `#17171a` (== background, current relationship kept) | `#efece5` (== background) | [true value] relationship kept |
| `--border-default` | `#26262b` | `#e2ded4` | [true value] the two line tiers |
| `--border-strong` | `#35353d` | `#cbc5b6` | [true value] the two line2 tiers |
| `--sidebar-hover` / `--sidebar-active` / `--seg-hover` | unchanged (ink alpha ladder 5%/10%, self-adapting) | same as dark (warm-ink alpha ladder) | [kept] the mechanism adapts to the fill color |
| `--text-on-accent` / `--toggle-knob` / `--overlay-scrim` | `#17171a` / `#ffffff` / `rgb(0 0 0/0.6)` | `#ffffff` / `#ffffff` / `rgb(0 0 0/0.6)` | [true value] spot-ink semantics; knob/scrim theme-invariant |

### 2.3 Brand and focus (the three slot classes of §1.3)

| Slot | Dark | Light | Source |
|---|---|---|---|
| `--card-button` | `#cba6f7` | `#8839ef` | [true value] the two spot tiers |
| `--focus-ring` | `#cba6f7` | `#8839ef` | [true value] the same-value relationship with the card button kept |
| `--text-on-accent` | `#17171a` (8.81:1) | `#ffffff` (5.41:1) | [true value] re-measured values |
| `--drop-tint-border` / `-base` / `-hover` | `#cba6f7` solid border + `color-mix(spot 5%/10%)` | `#8839ef` solid border + `color-mix(spot 5%/10%)` | [derived] hue swapped only; the 5%/10% tier ratios carried over from the current values |

### 2.4 Body-text ramp: one deliberate deviation (better-colors measured conclusion)

herdr's own `faint` is only 3.27:1 on light paper (faint2 about 3.15:1); on the herdr site proper they are decorative only. Copying them into the body-text ramp would mass-produce F4. Ruling:

- Dark side adopts herdr's full set: `--text-secondary` → dim `#cdccd2` (11.21:1), `--text-tertiary` → faint `#b0afb6` (8.22:1), `--text-dim` → faint2 `#908f96` (5.58:1, decorative only: timestamps/placeholders/inactive icons, per the XMON-55 convention).
- Light side **keeps the current warm ramp**: `--text-secondary` `#44403c` (about 8.8:1 on paper), `--text-tertiary` `#57534e` (re-measured 6.47:1), `--text-dim` `#a8a29e` (decorative only). Reason: the current values all pass and are same-source with the paper's warm tone; switching to herdr dim (6.54:1) is a downgrade, and to faint a violation. The herdr faint family may enter the light side only at decorative slots (for `--ring` see the last row of §2.1).
- `--col-head-text`: dark → dim `#cdccd2`; light keeps `#57534e` (6.47:1).
- `--menu-icon`: light keeps `#1c1917`; dark keeps `#71717a` — 3.44:1 on the new panel, accepted at the **non-text 3:1** bar (icons are not body text); the surface ticket notes the convention.

### 2.5 Selected/planned/badge family: the 15° rule (better-colors "one color one meaning")

Spot purple's hue is about 270°. Every slot within ±15° of spot (the current indigo family) goes back to the spot family; the blue/green/orange/red state slots (hue difference >15°) all stay — purple may only mean "brand / clickable", and states have their own colors (F7):

Back to the spot family (carried by the `--brand`/`--brand-fg` semantics): `--chip-plan-bg/fg`, `--tile-indigo-bg/fg`, `--overlay-select-indigo`, `--pick-selected-bg/fg`, `--indigo-500`/`--indigo-600` (brand-glyph uses), `--notify-icon-bg` + the glyph on it, `--primary-disabled` / `--indigo-disabled` / `--indigo-disabled-fg` (spot mixed down against the fill; the exact ratios pinned by the surface ticket's measurements; the disabled state is not accepted at 4.5 but must be distinguishable).

Selected-pair exact values (already measured; the surface ticket re-measures):

- Dark: fill = spot 14% mixed onto panel (≈`#363140`), text `#cba6f7`, 6.19:1.
- Light: fill = spot 14% mixed onto panel, text takes the deepened purple `#6d28d9`, 4.59:1. Note: on the light side, spot's raw color as text is only 3.50:1 (F3); **deepening one tier is mandatory**, not optional polish. This slot is a dedicated tier for "text on a tint fill"; the name must carry the role (e.g. `--spot-text-on-tint`); reusing `--card-button` as a stand-in is forbidden.

Kept (state semantics): the four `--col-dot-*` slots, the three `--badge-*` slots, `--chip-confirm/done/failed` plus `--tile-orange/hero`, `--diff-*`, `--fail-fg`, `--project-avatar-*` (`#e97b35` avatar identity color), the palette primitives `--blue/amber/green/rose/gray-500`, `--stop` (same hue as destructive but different lightness is the current dual-red coexistence; carried over, noted in the ticket).

### 2.6 Overlay/dialog/row-level slots: aligned to line and mass

| Slot | Dark | Light | Source |
|---|---|---|---|
| `--dialog-bg` / `--dialog-box-bg` | `#1e1e22` (box follows panel + border, current relationship kept) | `#e7e3da` (same as dark) | [true value] |
| `--dialog-ring` | `#35353d` | `#cbc5b6` | [true value] line2 |
| `--dialog-row-bg` | `#26262b` (mass, visible on the panel dialog) | `#ddd8cc` (same as dark) | [derived] relationship kept |
| `--row-selected` | `#26262b` | `#e2ded4` (== hover; selected is the hover ceiling) | [true value] |
| `--row-icon-bg` | `#35353d` | `#ddd8cc` | [true value] the mass family |
| `--overlay-divider` | `#26262b` | `#e2ded4` | [true value] line |
| `--range-chip-bg` / `-border` | `#26262b` / `#35353d` | `#e7e3da` / `#cbc5b6` | [aligned] |
| `--pill-idle-bg` | `#26262b` | `#ddd8cc` | [aligned] mass |
| `--dash-border` | `#35353d` | `#cbc5b6` | [true value] line2 (the dashed add-machine border) |
| `--toggle-track` | `#35353d` (visible on panel) | `#cbc5b6` (same as dark) | [derived] |
| `--chief-tab-bg` / `-active` | `#26262b` / `#35353d` | `#ddd8cc` (strip) / `#e7e3da` (active pill, direction carried from current: pill lighter than strip) | [true value + relationship] |
| `--seg-active` | `#35353d` | `#ddd8cc` | [true value] prototype active |
| `--tab-chip-bg` | `#1e1e22` | `#e7e3da` | [true value] panel (sits on the mass group fill) |
| `--agent-avatar-bg` | `#26262b` (== chip-idle-bg, relationship kept) | `#e7e3da` (same as dark) | [aligned] |
| `--chip-idle-bg` / `-fg` | `#26262b` / `#9ea3ae` (kept; the surface ticket re-measures at 4.5) | `#e7e3da` / `#4d5562` (kept; the surface ticket re-measures) | [aligned + kept] |
| `--notify-icon-bg` | `#35353d`, the glyph takes spot `#cba6f7` | spot 14% tint, the glyph `#8839ef` | [derived] the surface ticket re-measures at non-text 3:1 |

### 2.7 Shadow/radius/motion tokens (the better-ui landing convention)

The user picked Herdr's pair, not the V2 generic tier — shadows use the H tier's soft shadows, **not** the V2-generic `4px 4px 0` hard shadow:

- Light: card `0 1px 2px rgb(26 26 24/0.08)`, popover `0 8px 24px rgb(26 26 24/0.16)` (H light true values). Dark: no shadows, the line border carries the weight (H dark true values).
- The `--edge-ring` mechanism is kept (an inset spread ring; its color follows `--border-default` and adapts automatically; it does not break at fractional zoom, an existing conclusion).
- The `--drag-shadow` shape is kept (`0 8px 24px`, the reference-site recipe); its color switches to `rgb(26 26 24/0.18)` on the light side, and keeps the black tint on the dark side (black shadows are weak on panel; the surface ticket confirms on the artifact). `--chief-shadow` merges into the popover tier. `--fab-shadow` remains an alias of `--edge-shadow`.
- Radii: the first-batch migrated surfaces (checkbox tile, popover shell, in-surface primary/secondary buttons) go to radius zero; the `--radius` base and card radii do not move, awaiting the second-batch surface tickets one surface at a time (default follows V2 to zero; each surface must pass visual-spec re-review). The concentric-radius rule (better-ui: outer = inner + padding) is checked per surface on nested popovers.
- Motion tokens: `--dur-fast` 150ms equals the tw default, kept; `--dur-overlay` 200ms → converges to 150ms (ADR D3's mount fade-in goes to the default tier); the three easing tiers are kept. The hand-made values (140ms overshoot curve, 100ms ease-out, brightness(1.07)) coexist with the D4 preserved surfaces in `motion.css` as surface-scoped tokens/classes — no separate file (a single system, greppable).

The `taste` skill conclusion: HERDR-THEME-TOKENS.md is exactly the mode-layer true values pulled directly from herdr.dev's `style.css` + `site.css` on 2026-10-04 (first-hand token reverse-derivation already done); no surface beyond that table needs another browser reverse-derivation. This spec leaves no ticket for taste.

## 3. Migration order: token layer first, surfaces after, each step independently mergeable

Tokens are a global single source (`shadcn.css` is the only value holder; `tokens.css` only aliases); splitting tokens per surface would fork the system — hence the order is "one token flip + N surface skeletons", not each surface carrying its own tokens. Independently mergeable means: each step carries its own `e2e:affected` + visual-baseline reshoot, and main stays releasable after every merge.

| Step | Content | Why here | Independent-merge form |
|---|---|---|---|
| P0 | Infrastructure: add the `--spot-text-on-tint` (light `#6d28d9`), `accent-soft` (spot 14% mix) semantic slots, the disabled-mix rule, the theme-switch suppression utility | No visual change; the precondition names for later steps | A token-addition PR, zero visual diff |
| P1 | Token-value flip: §2's full table lands in `shadcn.css` (the `.light` mirror in sync), alias layer unchanged | A single-source flip settles the color account once; skeleton geometry does not move in this step, so the drift surface is minimal | A whole-site recolor PR + full visual-baseline reshoot (§5.3); `e2e:affected` falls back to the full suite (shared surfaces) |
| P2 | Checkbox skeleton: 16px/radius-0/ink border + on-state theme-color fill + the 140ms check / 90ms uncheck hand-made motion + press scale | The surface the prototype pins hardest; the checkbox is already the Base UI official component (#690), hooks ready | `checkbox-unified` + visual spec updated in sync |
| P3 | Popover skeleton: 12px inner padding/ink line/radius 0/Arrow + enter scale .98+fade 100ms (replacing slide) | The B1 popover shell is spec 16's designated first surface; the same crew closes it in passing | overlay-family specs + dialog-viewport pin re-review |
| P4 | Row hover/buttons: accent-soft tint, primary brighten brightness(1.07), secondary hover/active tokens | Pure token consumption, no geometry change, easiest to roll back | hover-family specs (card-press etc.) |
| P5 | danger/focus/rings: the two red values + the dark-side dark-text flip + the two `--ring` values + switch suppression | Heaviest semantics (clickability / dangerous actions); its own ticket makes revert easy | overlay-focus + brand-typo (renamed, see §5.2) |
| P6 | Second-batch surfaces closed out: board cards, sidebar, chief, detail, pages skeletons + radius zeroing | The largest volume and pin density (spec 16 B4 likewise capped at two lanes), goes last | Split into 2–3 surface tickets, parallelizable (different domains), same-file pairing forbidden (preferences §closing order) |
| P7 | Final acceptance: everything in §5 + fixture baseline sealed | The closing ticket; "test it next time" not accepted | Done only when green |

P1 and spec 16's relationship: if spec 16's unmerged batches are in flight at the same time as P1, "P1 merges first, the structure tickets rebase and follow" rules (the color canonical copy is single-source; the follower adapts; the reverse would create two canonical copies).

## 4. Relationship with the current Indigo brand: switch directly, no dual track

- Cut. `--card-button`/`--focus-ring` switch from `#4e47dd` directly to the two spot purples; no transition period, no dual track, no compat shim. Reason: the theme mechanism is a single `.light` switch; a dual brand would fork §2's full table again and double the e2e matrix; the prototype's H tier itself already dropped indigo; the current `#4e47dd` happens to be the prototype's A-tier light value, and the user's narrative is "the purple moves from indigo to Herdr purple" — continuity holds.
- Only two break points, written into P5's ticket: ① `--destructive-foreground` on the dark side flips from white to dark text (F2); ② `--pick-selected-fg` on the light side changes from the brand solid color to the deepened purple (F3). The remaining indigo traces (chip-plan/tile-indigo etc.) go back to the spot family per §2.5, leaving no live `--indigo-*` references (the slots may sit as empty placeholders for one release then be deleted, or be deleted outright with P1 — decided by the surface ticket; the ~40 consumer files are all switched in P1's own PR, none left dangling).
- `brand-typo.spec.ts` is renamed (`accent-typo.spec.ts`) with its assertions updated, with P5.

## 5. Acceptance

### 5.1 Dual-theme contrast measurement (the better-colors method: measure rendered pairs, no estimating)

The bright crops are based on the compiled output after P1 lands; the table below holds this spec's re-measured gate values, and the surface ticket must re-measure pair by pair (tolerance ±0.02; tool: this section's same relative-luminance formula, dual theme × light/dark):

Text pairs (≥4.5:1): primary-button text both tiers 5.41 / 8.81, body text both tiers 15.63 / 14.72, secondary text 8.71 / 11.21, muted both tiers 6.54 / 8.22, danger text 5.02 / 4.92, selected pairs 4.59 (light, deepened-purple scheme) / 6.19 (dark), the current pick pairs 5.45/5.21 voided.
Non-text pairs (≥3:1): `--ring` light 3.27 (the surface ticket falls back to dim if it fails), menu-icon dark 3.44 (passes at the icon bar).
Decorative exempt: the faint family's light-side values (3.27/3.15) may appear only in borders/placeholders/decorative icons; appearing in body text goes red.

### 5.2 Visual-spec update list

Must touch: `sidebar-visual`, `visual-polish`, `theme-toggle` (add switch-suppression assertions), `brand-typo` (renamed + assertions swapped), `checkbox-unified` (16px/radius-0/on-state fill), `card-press` (press token values), `overlay-focus` (ring color + offset).
May touch (P6 lists per surface): chief-family, detail-family, board-family visual assertions.
Rules: change CSS, change assertions in the same PR (F6); run once before and once after `--update-snapshots`, and explain the diff line by line (F1).

### 5.3 Fixture screenshot baseline reshoot plan

- Infrastructure: the fixture build is only 1.5s (existing baseline); the expensive part is shooting, not building.
- After P1 merges: dual theme × (board / popovers / checkboxes / buttons / danger confirm / pick selected rows), six groups before/after (the "before" shot from a one-off worktree stack of main before P1; old images may not stand in; the verify stack's vite hot-reloads changes but the server does not — the "before" must run on a one-off `origin/main` stack, following the existing discipline).
- Motion surfaces (P2/P3): one GIF before/after each (§1.2 method); static images supplementary only.
- Archiving: `docs/verify/<ticket>/` + PR body raw permanent links (SHA taken from command output, curl to 200; the Multica channel is retired, no comment route).
- How to run: during development `e2e:affected` (P1 touches shared surfaces and auto-falls back to the full suite); at closing, the full suite goes to CI's four shards; the local full run is 154s/617 cases but parallel lanes are the memory-pressure source — not a daily driver.

## 6. Ticket split list (agent-ready: each ticket's title + one-line scope + blocked edges)

1. `web(theme): land Herdr token values in shadcn.css (P1)` — the full §2 table flip + alias layer untouched + full visual-baseline reshoot. blocked: P0.
2. `web(theme): add spot-soft, spot-text-on-tint, disabled-mix and theme-switch suppression (P0)` — new semantic slots and the switch-suppression utility, zero visual diff. blocked: none.
3. `web(theme): V2 checkbox bone 16px square plus hand-made check motion (P2)` — tile geometry + on-state fill + 140/90ms motion + GIF evidence. blocked: #1.
4. `web(theme): V2 overlay bone plus scale-fade enter replacing slide (P3)` — popover shell geometry + Arrow + enter override + single-mechanism grep acceptance. blocked: #1.
5. `web(theme): accent-soft row hovers, button brighten, danger reds and focus rings (P4+P5)` — hover tint, primary-button hover, the two red values, the dark-side dark-text flip, ring colors, the brand spec rename. blocked: #1.
6. `web(theme): board/sidebar/chief/detail/pages bone convergence (P6)` — second-batch surface skeletons + radius zeroing; splittable further into 2–3 surface tickets (parallel across domains, same-file pairing forbidden). blocked: #1.
7. `web(theme): dual-theme contrast re-measure and fixture baseline seal (P7)` — everything in §5 re-measured + baseline sealed. blocked: #3, #4, #5, #6.

Merging belongs to the coordinator: the spec goes into `docs/spec/` with a PR, or lands directly; the ticket says which. This spec file itself enters the repo with the first P-ticket PR (`docs/spec/base-ui-theme.md`), no separate PR.

## Appendix: fact-source index (where the data was taken; values not copied again)

- V2 skeleton exact values: `library/t-accent-prototype/accent-compare-prototype.html` L36–83 (black-and-white skeleton), L92–103 (theme-color layer), L108–159 (H's two tiers), L316–380 (checkbox/button/popover geometry and motion), L772–806 (the WAAPI motion-engine values).
- Herdr true values: `HERDR-THEME-TOKENS.md` in the same directory (the site's mode layer paper/ink + 23 palettes; for reference, not landed).
- Current canonical copies: `apps/web/src/styles/shadcn.css` (the only color value holder), `tokens.css` (aliases + non-color layers), `motion.css` (D4 preserved surfaces + replication values pending retirement), `docs/adr/0009-site-wide-motion-converges-on-shadcn-defaults.md` (the canonical copy of the motion relationship).
- Contrast: §5.1's values were recomputed with the relative-luminance formula (the prototype's parenthesized values 5.41/8.8/6.42/5.34/8.72/5.43/5.02/9.18/5.48/8.46 all checked item by item and consistent; H-dark takes the re-measured 8.81).

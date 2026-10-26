# #1011 re-evaluation evidence: the #883 model-picker row focus ring + the two faces' row indent

Verdict: **not self-resolved**. After the official geometry landed (the #1003 registry alignment + wave-1 construction + the #1010 select retirement), both of #883's defects reproduce on current main:

1. **The row focus ring is still clipped**: the row's focus indicator = the Button base's `focus-visible:ring-3`
   (a 3px box-shadow, drawn outside the row box at offset 0; `outline-none` already suppressed the #388 global
   outline law). The row box's four edges are flush with the listbox's clip box (the #872 full-bleed row law: the shell's horizontal padding is zeroed and the row carries its own inset), and the listbox is an `overflow-y-auto` scrolling container → the ring segments hugging the clip box are clipped:
   - the settings face (compaction model, scenario 101): the left/right/top segments disappear, leaving only a horizontal bar under the row (+ the see-through ink under the semi-transparent selection) — the same shape as the original #883 report;
   - the drawer face (chief main model, scenario 111, single row): the row box == the clip box, all four edges flush,
     all four segments clipped, and after keyboard focus there is **no usable outer ring at all**, only the in-row see-through ink.
2. **The two faces' row indents are still not unified**: drawer face 20px vs settings face 12px (measured from the name ink edge to the popover's inner edge).

## Measurement method

probe = `apps/web/e2e/probe-1011.mjs` (geometry / computed / keyboard-navigation stress / frames) and
`apps/web/e2e/probe-1011-attr.mjs` (ring-ink attribution), run on the fixture build
(`vite build --mode fixture` + `vite preview`, port 8398),
deviceScaleFactor 4, light face (the same face as the #872 evidence frames).

**Attribution criterion (the judgment basis, interference-resistant)**: in the same focused state, change exactly one variable and take two frames for a per-pixel diff —
- `*-attr.json`'s `diffShadowRemoved`: the diff before/after `row.style.boxShadow='none'` =
  the ink the row box-shadow **actually draws** under the current clipping;
- `diffOverflowVisible`: the diff before/after `listbox.style.overflow='visible'` = **the ink clipped away by the scroll container**.
There is no layout/position change between the two frames, so the diff attributes to exactly the one changed property.

`measurements.json`'s `ringRow1/ringRow2.bands` (the two-frame method of baseline frame vs focused frame) is a reference, not a criterion: the popover drifts subpixel between the two frames, and the out-of-row band counts get polluted by the popover's edge pixels.

Keyboard-navigation stress records (`measurements.json.nav`): on open, focus sits on the listbox container (the typeahead contract); Tab enters the first row (`:focus-visible` hits); on the settings face Tab moves row by row in order and Shift+Tab steps back normally; the drawer face has a single row, and a second Tab moves focus out of the popover, which closes as focus leaves (the Base UI non-modal law); Escape closes the face and returns focus to the trigger button.

## Files

| file | content |
| --- | --- |
| `measurements.json` | both faces' geometry (row/clip-box/popover rects, flush judgment, row indent, computed focus styles, tokens), keyboard-navigation stress records |
| `drawer-attr.json` / `settings-attr.json` | the ring-ink attribution diffs (clipped ink vs drawn ink), bboxes and counts |
| `drawer-menu-focused-row1.png` / `settings-menu-focused-row1.png` | whole-menu frames with the first row keyboard-focused (the current clipped state) |
| `settings-menu-focused-row2.png` | the settings face's middle-row focus frame (the top/bottom segments visible inside the content area, the left/right segments still clipped) |
| `drawer-attr-overflow-visible-C.png` / `settings-attr-overflow-visible-C.png` | reference frames with the listbox overflow set to visible in the same focused state = the ring's complete intended shape |
| `drawer-row-left-edge-zoom.png` / `settings-row-left-edge-zoom.png` | 4x zoom of the row's left edge: no ink for the left ring segment under clipping |
| `drawer-trigger-ring-control.png` / `settings-trigger-ring-control.png` | positive control: the trigger button (outside the popover, no clipping ancestor) draws all four segments of the same recipe's ring |
| `indent-compare.png` | the two faces' focused frames side by side, annotated with the measured indents (20px vs 12px) |

## Measured numbers (light face, css px)

- Settings face: row box [839,1206]x[233,265], listbox [839,1206]x[233,297],
  `overflow: auto`, zero padding; the row box's left/right/top edges differ from the clip box by < 0.5px.
  `diffShadowRemoved`'s bbox stops at the row box + the bottom segment ([233,267.75]), no ink on the left/top segments;
  `diffOverflowVisible`'s bbox expands to [836,1208.75]x[230,263.25] = the left/right/top segments return.
- Drawer face: row box == listbox == [1066,1344]x[196.25,228.81] (a single full-bleed row);
  `diffShadowRemoved` is only 1402 px and its bbox sits entirely inside the row box (see-through ink), all four outer-ring segments absent;
  `diffOverflowVisible` 28278 px, bbox [1063,1346.75]x[193.25,232] = all four segments return.
- Row indent: on the drawer face the name ink edge is 20px from the popover's inner edge (row `px-5`); on the settings face 12px (row `px-3`).
- The focus indicator computed: `outline-style: none` (`outline-none` suppressing the #388 global law),
  `box-shadow: … oklab(0.634 … / 0.5) 0 0 0 3px` (the ring-ring/50 gray ring, drawn outside the box).

## Side observations (filed for the re-cut ticket, not fixed in this one)

- When the listbox container itself is keyboard-focused it gets the UA default blue ring (`:focus-visible` hits the div, which the #388 global law's element table does not include) — a different word from the in-repo ring recipes.
- The focus vocabulary has two sources: the row's Button gray ring (`--ring`/50) vs the #388 global law's `--focus-ring`.
- The Button base's `transition-all` violates "only transition the properties that change", and forces the ring sampling to wait for the settle.

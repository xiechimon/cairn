# #1266 pixel + style-event evidence

Capture method: CDP `Page.startScreencast` (everyNthFrame 1, jpeg) plus passive
style-event listeners (`transitionrun` / `animationstart` / `animationend`) on
the `.chief-drawer` aside, driven by `Meta+j` presses at 700ms cadence, 10
open/close cycles per run. Drawer-region mean luminance is measured per painted
frame on the bottom-right 460×680 crop of the 1440×732 viewport. No computed
style is read between a press and its assertion window — forced synchronous
style recalculation collapses the two-recalc bounce window into one and masks
the flash (the Heisenbug note in `apps/web/e2e/chief-toggle-flash.spec.ts`).

## The flash signature

On the minimizing press the exit keyframe (`exit`, 200ms, `fill-mode: none`)
fades the window to opacity 0; when it ends, the animation stops applying and
the computed opacity snaps back to the base value 1 for the recalculation
before Base UI's `hidden` commit lands. The aside carries an incidental
`transition: all 200ms` (the `duration-*` utility sets `transition-duration`
and `transition-property` defaults to `all`), so that snap-back becomes a
painted 200ms re-fade: the closed window repaints at ~full brightness and
fades out a second time. Pre-#1234 the parked popup was `display:none`, which
stopped painting before the bounce could show; the #1067 visibility park keeps
the box painted, which is what turned the bounce into a user-visible flash.

Mechanical signature (per close, deterministic 10/10 cycles):

- one `transitionrun` event with `propertyName=opacity` on the aside,
- one single-frame luminance jump back to the open-state level (dark theme),
  or a close paint episode of ~2× the exit duration (light theme).

## Measured values

| run | theme | surface | opacity `transitionrun` per 10 closes | close paint episode | luminance jump at close |
|---|---|---|---|---|---|
| main @ 6a5ef79c (broken) | dark | fixture `?scenario=111` | 10 | ~400ms (exit + re-fade) | +12.04 (30.9 → 42.9), 10/10 cycles |
| main @ 6a5ef79c (broken) | dark | live verify stack (unbound chief) | 10 | ~320ms | +9.53, 10/10 cycles |
| main @ 6a5ef79c (broken) | light | fixture `?scenario=111` | 10 | ~400ms | low contrast; episode length is the signal |
| 7f56b394^ = 498bd88c (pre-regression baseline) | dark | fixture `?scenario=111` | 0 | exit fade only | none; only the enter-fade rises (+1.7/+1.9/+1.8/+1.5 per open) |
| fixed build | dark | fixture `?scenario=111` | 0 | exit fade only (~180ms) | none |
| fixed build | dark | live verify stack | 0 | ≤144ms | none (remaining >5 deltas are screencast sampling gaps across a monotonic fade) |
| fixed build | light | fixture `?scenario=111` | 0 | ~185ms | none |

Event trace of one broken close (fixture, `performance.now()` ms):

```
4798 attr data-open removed / data-closed + data-ending-style set   <- minimizing press
4807 animationstart exit
5008 animationend exit + attr hidden set + data-ending-style removed
5024 transitionrun opacity (computed 0.929 — the snap-back re-fade is running)
5224 transitionend opacity
```

Same trace on the fixed build: `animationstart exit` → `animationend exit` +
`hidden`, then only the visibility park transition; zero opacity transitions.

## Files

- `before-close-dark.gif` — live verify stack, broken build: one ⌘J close
  cycle; the window fades out, repaints at full brightness, fades out again.
- `after-close-dark.gif` — same stack and flow on the fixed build: single
  monotonic exit fade.
- `spike-compare-dark.png` — broken vs fixed at close+~240ms: full window
  repaint vs gone.
- `e2e-red-on-main.log` — `chief-toggle-flash.spec.ts` failing on main
  (Received: 1 and 2 opacity transitions where 0 are allowed).

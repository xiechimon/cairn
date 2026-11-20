---
name: cairn-motion
description: Motion craft for apps/web/src — whether an element animates and the exact values for its enter, exit, transition, press or loop, through the vendored better-motion skill with Cairn overrides. Load when a UI change under apps/web/src adds or touches animation, transition, enter/exit, press feedback, loading or status motion.
---

# cairn-motion

Motion work starts from `upstream/README.md` — a verbatim copy of Jakub Krehel's `better-motion` at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`). The upstream `SKILL.md` is vendored as `upstream/README.md`; links in its reference files that say `SKILL.md` point there. Read it first, then the reference file for the recipe needed (`transitions.md`, `enter-exit.md`, `icon-transitions.md`, `layout-animation.md`, `drag.md`, `performance.md`, `slow-motion.md`).

## Cairn overrides

Where this table differs from upstream, Cairn wins. An upstream rule not listed applies as written — upstream's own calibration says a deliberate, consistent project convention is a preference and not a finding. Rows marked **pending owner A/B** record the adopted direction but change nothing until the owner's side-by-side pick lands (`docs/research/design-skills-2026-11-20.md`, section 7.2).

| Upstream rule | Cairn | Rules |
|---|---|---|
| Press scales to `0.96` over 150ms | No movement today: a pressed control takes an instant inset tint in the same frame (#3152). Direction: `scale(0.97)` on standalone labelled `Button` variants only, tint kept; never on rows, menu items, sidebar or icon buttons, never `:disabled` — **pending owner A/B** (taste 3) | A2, C24 |
| Springs with `bounce: 0` | No motion library and no spring easings today; a spring stand-in is `cubic-bezier(0.2, 0, 0, 1)` or a `linear()` no-bounce curve, on the segmented pill, side panel and jump-to-latest only. Bounce stays `0` on all chrome (decided); one rare celebratory `0.15` — **pending owner A/B** (taste 5) | V24 |
| `ease-out`, `cubic-bezier(0.2, 0, 0, 1)` as the spring stand-in | Enters and exits on overlays and panels take a strong ease-out (adopted); which strong curve, `cubic-bezier(0.23, 1, 0.32, 1)` or `--ease-out-expo`, is **pending owner A/B** (taste 4). Micro-interactions and color/hover changes keep `--ease-standard` | V1, V24 |
| Durations: tooltip 150ms, dropdown 250ms, modal 350–450ms | The motion table in `docs/design/surfaces/motion.md` governs: overlays run 100–220ms, and a surface with no row in the table gets no motion | V24 |
| Enter scale `0.96`–`0.97` popup / `0.98`–`0.99` modal, `transform-origin` at the trigger | Overlays enter `scale(.95→1)` today; the pilot direction is trigger origin at `0.97` for anchored popups and `0.98` centred for dialogs, landing only with the overlay pilot's before/after evidence and a new `M` check | V24, R1 |
| Stagger staged entrances by 100ms | No entry animation on chat messages, list rows or board cards (decided); the Growth rows in `docs/design/surfaces/motion.md` are the only live-surface choreography. A first-run stagger — **pending owner A/B** (taste 6) | V24, C23 |
| Icon cross-fade `0.25→1`, `blur(4px)`, `0.3` spring | Values adopted, written as the CSS form (`cubic-bezier(0.2, 0, 0, 1)`, 300ms, both icons in the DOM) — Cairn has no Motion library | V24 |
| `layoutId`, `AnimatePresence`, `whileTap`, `MotionConfig`, drag props | N/A — `apps/web/package.json` has no motion library; use the CSS recipe each reference file also gives | V24 |
| Gate motion behind reduced motion | Already shipped: `src/styles/motion.css` shrinks keyframes to 0.01ms and runs loops once; transitions are untouched, the `grow-*` utilities switch off, and the user's own actions stay instant | A2 |
| Suppress transitions on theme switch | Already shipped as `.theme-suppress` in `src/styles/motion.css` | A2 |

Cairn tokens replace upstream's raw values: durations `--dur-fast` (150ms) and `--dur-overlay` (200ms), curves `--ease-standard` and `--ease-out-expo` (`src/styles/shadcn.css`).

## Choreography and performance references

Two of Emil Kowalski's skills ride along as reading, verbatim at `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (MIT, `references/LICENSE`): `references/choreograph/README.md` with `RECIPES.md` for several elements moving together — the Growth rows — and `references/animation-performance/README.md` for the frame budget. Where their defaults (`scale(0.97)` press, `bounce 0.2`, `cubic-bezier(0.23, 1, 0.32, 1)`) conflict with the table above, the table wins.

## Before wrap-up

Run the upstream **Before you finish** detection table over the diff, with this table's overrides applied. Motion evidence is a recording (P3), replayed at about 0.1x before calling it done; name the rule ids checked in the wrap-up.

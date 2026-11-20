---
name: cairn-a11y
description: Accessibility for apps/web/src — keyboard and focus behaviour, accessible names, ARIA, forms, live-region announcements, hit areas, zoom and text resize, through the vendored better-accessibility skill with Cairn overrides. Load when a UI change under apps/web/src touches focus, keyboard use, labels, announcements, hit areas or form errors, or when an axe finding has to be fixed.
---

# cairn-a11y

Accessibility work starts from `upstream/README.md` — a verbatim copy of Jakub Krehel's `better-accessibility` at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`). The upstream `SKILL.md` is vendored as `upstream/README.md`; links in its reference files that say `SKILL.md` point there. Read it first, then the file for the job: `focus-and-keyboard.md`, `semantics-and-aria.md`, `hit-areas.md`, `forms.md`, `screen-readers.md`, `motion-and-zoom.md`.

It reports each failure against the WCAG 2.2 criterion it breaks. Cairn's rule ids say where the fix lands; both go in the report.

## Cairn overrides

Where this table differs from upstream, Cairn wins. An upstream rule not listed applies as written. Contrast measurement, spacing between controls and the wording of labels belong to other wrappers, named in the rows.

| Upstream rule | Cairn | Rules |
|---|---|---|
| Aim for `44px` on touch and `40px` on desktop where density permits; `24px` is the AA floor | Fixed, not a heuristic: `24px` on desktop and `44px` on touch, measured under `pointer: coarse` too. The Tasks checkbox and the `36×20` switch extend with a pseudo-element, and extended areas never overlap; decorative layers take `pointer-events: none` | A1 |
| Custom focus ring needs a project token and `3:1` against every adjacent colour | Cairn draws its own ring from `--focus-ring` (ochre, the waiting-on-you role) and `--focus-halo` on fields. Never `outline: none` without it, and forced-colors keeps the system colours | A2, V5, V1 |
| Prefer `<dialog>` opened with `showModal()`; a custom overlay sets `inert` and restores focus | The shells own it: `components/ui/dialog-shell.tsx` and `alert-dialog-shell.tsx` trap, close on Escape and return focus to the trigger. Never hand-roll an overlay mount or an Escape hook | V10 |
| A client-side route change updates `document.title` and moves focus to the new `<h1>` | Cairn is one window with panels, not routes: switching to a view (settings page, task detail, archived page) moves focus to that view's heading, `document.title` names it, and the sidebar row that opened it keeps `aria-current` | V10 |
| Announce dynamic content: `role="status"` for non-urgent updates, `role="alert"` for urgent untied errors | A streaming reply is announced once when it settles, never token by token, so a screen reader is not flooded; counts and long-running states go to a polite region; `role="alert"` is reserved for an unrelated urgent failure and never for a toast | — |
| Nothing the user needs runs on a timer; a toast carrying an action stays until dismissed | Same, and Cairn's diagnostic check is a popover that switches in place to its result, never a toast that disappears | C22, C24 |
| Validate on submit; `aria-invalid` plus `aria-describedby`; focus the first invalid field | Cairn adds the same-frame rule: a control the user switched or a row they marked shows the result instantly and rolls back with a message beside it when the request fails. A form keeps its submit enabled and marks the failing field, and the message says what to do next rather than repeating the server's text | C24, C5, C7 |
| Disabled means unavailable; `aria-disabled` only when it must stay focusable | Native `disabled` for a genuinely unavailable control, with the reason beside it; a control with fewer than two real choices, or a label that only says something cannot be done, is not rendered at all | C7, C25 |
| `1.4.3` text `4.5:1`, `1.4.11` component boundaries `3:1`; measure the rendered pair | The thresholds apply; the measurement belongs to the colour route in `cairn-polish` (`better-colors`). `wcag2a/aa/21aa/22aa` with 0 axe violations in both themes is the gate | A3, V28 |
| Icon-only button needs a descriptive `aria-label`; the visible label text appears in the name | Cairn also requires a visible tooltip on every icon-only control, sharing the same words as the accessible name | C4 |
| Text survives 200% resize and reflows at `320px` without horizontal scrolling; never `maximum-scale=1` | R1 is the bar: every state at 1440px and 390px, light and dark, no horizontal scroll. The 390px layout is a narrow desktop window, so iOS input zoom is out of scope here and the type route owns it | R1, V13 |
| Wrap movement in `@media (prefers-reduced-motion: no-preference)` so motion is opt-in | Shipped the other way round in `src/styles/motion.css`: keyframes shrink to `0.01ms`, loops run once, the `grow-*` utilities switch off, and the user's own actions stay instant. Under reduced motion a state change keeps its non-motion cue and loses only its motion | A2, V24 |
| Skip link when repeated chrome precedes `<main>` | The app shell gives each panel one `<main>` and the sidebar is the navigation, so a skip link inside an already scoped window adds a stop and nothing else | — |
| Logical properties for anything that mirrors | Cairn ships `zh` and `en` only, so there is no mirrored layout to test; logical properties are preferred where they cost nothing and the layout route in `cairn-polish` owns spacing | R1 |
| Automated audit as one input, never a verdict | Cairn's audit is a rule: 0 violations at `wcag2a/aa/21aa/22aa` in light and dark, and a manual keyboard walk still decides | A3, A4 |

## Before wrap-up

Run the upstream **Before you finish** detection table over the diff, with this table's overrides applied. Walk the touched flow keyboard-only: every stop shows the ring, Escape closes what it opened, focus returns where it came from. Then run the axe spec and name the rule ids checked. A screen-reader walk you did not run is `Not verified`, never a pass.

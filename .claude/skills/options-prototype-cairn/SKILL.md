---
name: options-prototype-cairn
description: The Cairn specifics for the options-prototype method — the repo's template, Playwright shoot script, prototype location and how design-cairn's draft-first rule calls for the owner's pick. Use together with the personal options-prototype skill when asked for options, versions or variants on a cairn screen.
---

# options-prototype-cairn

The general method — three structural directions, `1/2/3` key switching, grayscale why-notes, the shoot-and-check loop — is the `options-prototype` skill. This file holds only what is Cairn-specific.

## Cairn specifics

- Current screen: launch the live stack (`verify-cairn`) and capture each state with `node .claude/skills/verify-cairn/scripts/vp.mjs capture <route>`; seed states the stack cannot reach. Open the surface's shots in `docs/design/references/<surface>/`.
- Template: build the single HTML file from [`template.html`](template.html), a worked example for the Providers settings page. Copy real strings from `apps/web/src/i18n/`; grayscale only.
- Location: save prototypes under `.claude/prototypes/` (gitignored), never committed.
- Frame check: `node .claude/skills/options-prototype-cairn/scripts/shoot.mjs <file> <outdir>` runs the repo's Playwright and exits 1 on page errors.
- Notes go in the owner's conversation language, each a _why_ with an arrow on its element.
- Handover: open the HTML in the owner's browser (`open <file>` on macOS) and send the file plus one tiled overview with a one-line recommendation; the pick happens on the prototype, not on prose.

## Called by design-cairn

`design-cairn`'s draft-first rule sends new work on the five main surfaces through this skill before code: the owner picks a direction on the prototype, the direction and its reason go into the UI brief's `Draft:` field, and the draft is then built from the real components and tokens under `design-cairn`. The prototype is a decision aid, never code to port.

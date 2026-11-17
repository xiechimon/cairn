---
name: options-prototype-cairn
description: Three structurally different directions for one cairn screen as a single grayscale HTML prototype, switched with keys 1/2/3, clickable, with handwritten notes saying why each choice was made. Use when a cairn page looks bad, when design-cairn's draft-first rule needs the owner's pick, or when asked for options, versions or variants of a UI. In this repo it replaces any global options-prototype skill.
---

# options-prototype-cairn

The owner compares _directions_, not styles. Each round gives three ideas for the same screen that differ in structure, every one annotated with its reasons, so the pick comes with a reason the owner can say out loud. The picked direction then becomes the draft that `design-cairn` requires before code.

## Steps

1. **See the current screen.** Start the live stack (`verify-cairn` launch) and capture the page in every state it has with `vp.mjs capture <route>`; seed states the stack cannot reach. Open the surface's shots in `docs/design/references/`. List the _defects_: concrete, pointable problems ("the title appears twice", "a third of the width is an empty column"). Done when each defect names an element you could draw an arrow to.
2. **Pick three directions.** Each changes structure: what is shown, in which layout, in what flow. Color, radius and font do not count. Name each in a few words by its idea (`One card`, `Empty = picker`, `Lean master-detail`). Usually one direction follows the reference product. Done when every defect from step 1 is answered by at least one direction, and no two directions answer it the same way.
3. **Build one HTML file** from [`template.html`](template.html), a worked example for the Providers settings page: replace the frame, `STATES`, `STATE_LABELS` and the `V` table (one render function per state, plus `notes` per state). Rules:
   - Grayscale only. Images become labelled gray boxes with their size and mood.
   - Real copy: the strings from `apps/web/src/i18n/`, the product's real labels.
   - Primary buttons work and lead to the next state (add → dialog → populated). Switches toggle.
   - `1/2/3` switch directions, `E` cycles states, and the bottom bar shows both.
   Save it under `.claude/prototypes/` (gitignored), so it is never committed.
4. **Write the notes** in the owner's conversation language. Each note is a _why_: a defect it fixes, or the user moment it serves. A note that only describes what is on screen gets rewritten or cut. Two to four notes per direction per state, each with an arrow ending on the element it explains.
5. **Check every frame.** Run `node .claude/skills/options-prototype-cairn/scripts/shoot.mjs <file> <outdir>`. It screenshots every direction × state and exits 1 on page errors. Open every image: each arrowhead lands on its element, and no note covers content. Fix the `ax/ay` coordinates and reshoot until every arrow is right; the first pass is usually off by a row.
6. **Hand it over.** Open the HTML file in the owner's browser yourself (`open <file>` on macOS) — the owner picks a direction by using the prototype, not by reading a path. Also send the file, the current-screen capture and one overview image (all frames tiled), with a one-line recommendation and its reason. Once they pick, record the direction and the reason in the UI brief's `Draft:` field, then build it from the real components and tokens under `design-cairn`. The prototype is a decision aid, never code to port.

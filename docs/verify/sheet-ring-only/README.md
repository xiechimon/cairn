# Sheet edge: hairline ring only

`shots.mjs` loads `/app?scenario=22d` from two fixture builds at 1440x900,
DPR 3: `before` is `main` at `09049849` (served on 28412), `after` is this
branch (served on 28411). It captures the sheet's top-left corner where the
sidebar meets it, in light and dark, and the full board in light.
`result.json` is the sheet's computed `box-shadow` for each build and theme.

| file | what it shows |
| --- | --- |
| `compare-corner-light.png` | before (left) and after (right), corner magnified 2x |
| `before-corner-light.png`, `before-corner-dark.png` | the outer shadow's grey halo in the canvas gap, cut straight where the sidebar starts |
| `after-corner-light.png`, `after-corner-dark.png` | the inset hairline ring only |
| `before-board-light.png`, `after-board-light.png` | the full board |

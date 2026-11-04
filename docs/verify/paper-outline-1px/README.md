# Paper outlines at one CSS pixel on 2x screens

`shots.mjs` loads `/app` in light theme at 1440x900, DPR 2, from two web
builds that proxy to the same live server on 8787. `before` is `main` (the
user's dev stack on 5173), `after` is this branch (a dev server on 5174).
`result.json` holds the computed box-shadow of the board sheet, the first
task card and the active sidebar row.

On main, the sheet and card rings use `--hairline`, which is 0.5px at 2dppx,
while the active row and `新任务` button use 1px. After, all four are 1px.

| file | what it shows |
| --- | --- |
| `before-top-left.png`, `after-top-left.png` | sidebar, sheet corner and first cards |
| `before-card.png`, `after-card.png` | the first card's outline |

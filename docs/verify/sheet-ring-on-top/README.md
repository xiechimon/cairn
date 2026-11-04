# Sheet ring drawn above the sheet's children

`shots.mjs` loads `/app` in light theme at 1440x900, DPR 2, from two web
builds that proxy to the same live server on 8787: `before` is `main` at
`d2ead90a` (the user's dev stack on 5173), `after` is this branch (a dev
server on 5174). It captures the sheet's left edge where it meets the top bar
and the columns, lists children with a background on that edge, and checks
that the task detail page below 816px still draws no ring.

On main the ring is an inset box-shadow on the sheet, which paints under the
sheet's children; `.board-scroller` has a background, so the left edge line
stops at the top bar's divider. After, the ring is the sheet's `::after` at
z-index 10 in an isolated stacking context, so it draws above every child.

| file | what it shows |
| --- | --- |
| `compare-left-edge.png` | before (left) and after (right), magnified |
| `before-left-edge.png`, `after-left-edge.png` | the edge crops |
| `before-board.png`, `after-board.png` | the full board |

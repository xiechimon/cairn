# Paper icons, card outlines and the orchestration footer

`shots.mjs` loads `/app` in light theme at 1440x900, DPR 2, from two web
builds that proxy to the same live server on 8787, so both show the same real
tasks. `before` is `main` at `34d9a35b` (the user's dev stack on 5173).
`after` is this branch (a dev server on 5174). `result.json` holds the
computed card box-shadow, the first three sidebar nav icon colors, the card
meta icon color, and the orchestration text on the first card.

Task #68 has a chief orchestration round queued, blocked on the offline
machine `mea`. Before, the card laid a half-transparent disabled `编排中` button
over its time. After, it shows a footer: `编排中 · 等 mea 上线`, plus `查看会话`.

| file | what it shows |
| --- | --- |
| `before-top-left.png`, `after-top-left.png` | sidebar icons, top bar, first two cards |
| `before-first-card.png`, `after-first-card.png` | card #68: overlay vs footer, soft vs crisp edge |
| `before-board.png`, `after-board.png` | the full board |

# Paper page patterns: card radius, EmptyState, settings list

`capture.mjs` loads `/app/account?scenario=13`,
`/app/resources/agents/r3-builder?scenario=agent-detail`, `/app/api-keys`
(empty fixture) and `/app?scenario=01` at 1440x900, DPR 2, in light and dark,
from a fixture build (`vite build --mode fixture`) served by `vite preview`.
It waits for every image to finish loading before the shot. `before` is
`origin/main` at 790eec12, `after` is this branch. `<label>-metrics.json`
holds card radius, ring and row heights, and the empty-state icon, tile,
title, description and button faces.

Pixel diff, before vs after (device pixels, threshold 8/255):

| page | changed region |
| --- | --- |
| account, light and dark | only x 908-932 and 2424-2448: the card's left and right corner columns |
| agent overview, light and dark | same, corner columns only |
| API keys, light and dark | only the empty-state block (x 1456-1900, y 260-590) |

Measured faces:

| what | before | after |
| --- | --- | --- |
| account / agent settings card radius | 12px | 10px (`--radius-card`) |
| board task card radius | 10px (`--radius-panel`) | 10px (`--radius-card`) |
| account rows | 52 / 52 / 52, dividers 1 / 1 / 0 | unchanged |
| API keys icon | ink, on a 32px `#ebe4d8` tile | ink-3 `#746a5f` (dark `#b3aeaa`), 24px, no tile |
| API keys title | 14px 500 | 14px 500 (`text-card-title`) |
| API keys description | 14px ink-2, 384px wide | 12px ink-3 (`text-meta`), max 320px |
| API keys button | default variant, size sm, 28px | default variant, size default, 32px, 8px corners, `text-ui` |

| file | what it shows |
| --- | --- |
| `before-light-account.png`, `after-light-account.png` | account page, light |
| `before-dark-account.png`, `after-dark-account.png` | account page, dark |
| `before-light-agent.png`, `after-light-agent.png` | agent overview, light |
| `before-dark-agent.png`, `after-dark-agent.png` | agent overview, dark |
| `before-light-api-keys.png`, `after-light-api-keys.png` | API keys empty state, light |
| `before-dark-api-keys.png`, `after-dark-api-keys.png` | API keys empty state, dark |

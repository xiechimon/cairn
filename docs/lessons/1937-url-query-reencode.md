---
Category: A URL helper re-serialized the query through `URLSearchParams` on every navigation, so commas in `projects=` came back as `%2C` and the filter URL changed under the board
Source: #1937 (2026-10-27)
Level: 2
Safeguard: `apps/web/e2e/board-filter.spec.ts` (the `全部选中` readout case) pins the literal comma form; the task panel writes the URL only when `panel` or `task` actually change
Intercepts: 1
Recurrences: 0
Notes: Negative control: the unconditional rewrite went red in that case, and the guarded write is green
---

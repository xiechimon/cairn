---
Category: `board-filter` e2e went red on three separate pre-push runs of #1706 and this branch (`tags=docs` instead of `tags=bug,docs`) and was written off as a busy-machine flake; the cause was a real race: `toggleTag` / `toggleProject` in `board-page.tsx` built the next filter from the render-time `selectedTags`, so a second pick before the re-render dropped the first
Source: ui/claude-shell (2026-10-25)
Level: 2
Safeguard: Both toggles read the current URL at click time (`latestFilters`); `e2e/board-filter.spec.ts` "two type picks in the same frame" clicks twice in one task
Intercepts: 0
Recurrences: 0
Notes: Negative control: the new spec on the old `board-page.tsx` receives `?scenario=board-tags&tags=docs`, the exact flake signature; with the fix it passes
---

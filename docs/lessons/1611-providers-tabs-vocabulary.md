---
Category: When extending the vocabulary (adding gemini at runtime), only the types and components were changed, and the old assertion pinning the tab count in `providers-tabs.spec.ts` was missed
Source: #1611 (2026-10-25)
Level: 2
Safeguard: `pnpm --filter @cairn/web e2e:affected` goes red on that spec with `toHaveCount(2)`; the spec now expects three tabs and pins the Gemini position
Intercepts: 1
Recurrences: 0
Notes: The negative control is this real red: 3 elements vs 2 failed before the change, all 1197 green after; the web surface of vocabulary extensions is already pinned by that spec, no new gate
---

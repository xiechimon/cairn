---
Category: When the vocabulary grew (gemini added at runtime), only the types and components were changed and the old assertion pinning the tab count in `providers-tabs.spec.ts` was missed
Source: #1611 (2026-10-25)
Level: 2
Safeguard: `pnpm --filter @cairn/web e2e:affected` went red on that spec's `toHaveCount(2)`; the spec now expects three tabs and pins the Gemini slot
Intercepts: 1
Recurrences: 0
Notes: the negative control is this real red: 3 elements vs 2 failed before the change, all 1197 green after; the web surface of vocabulary changes is already pinned by this spec, no extra gate
---

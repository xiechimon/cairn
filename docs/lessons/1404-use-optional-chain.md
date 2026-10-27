---
Category: New code called a method after `!== null &&`, drawing a biome `useOptionalChain` warning
Source: #1404 S5a
Level: 2
Safeguard: biome `lint/complexity/useOptionalChain` (`pnpm lint`)
Intercepts: 1
Recurrences: 0
Notes: Negative control: the evidence-directory check in `verdict.ts` written as `rawDir !== null && rawDir.startsWith` made biome report the rule without autofix; as `rawDir?.startsWith` the file's lint passes. Existing gate, no new one
---


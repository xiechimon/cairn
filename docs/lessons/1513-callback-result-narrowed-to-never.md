---
Category: Read the result from a local variable assigned inside a synchronous callback, which TypeScript narrowed to never
Source: #1513 (2026-10-23)
Level: 1
Safeguard: The runner stores the skill-resolution result in an explicitly typed object property; `pnpm typecheck` checks the consumers
Intercepts: 1
Recurrences: 0
Notes: Negative control: the injected read on the original local variable errors TS2339; assigning to the object property in the callback passes
---


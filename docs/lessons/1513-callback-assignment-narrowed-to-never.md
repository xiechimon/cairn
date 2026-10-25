---
Category: Reading a result from a local variable assigned inside a synchronous callback; TypeScript narrowed it to never
Source: #1513 (2026-10-23)
Level: 1
Safeguard: the runner stores the skill-resolution result in a property of an explicitly typed object; `pnpm typecheck` covers the consumers
Intercepts: 1
Recurrences: 0
Notes: negative control: reading `injected` from the original local variable reports TS2339; passing the callback result through the object property works
---

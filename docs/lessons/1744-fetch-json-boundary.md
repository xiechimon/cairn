---
Category: Parsing a fetch body as a typed object without validating JSON null or null message elements made ordinary requests throw before forwarding
Source: #1744 review (2026-10-27)
Level: 2
Safeguard: `pi-compaction-ceiling.test.ts` forwards JSON null, primitives and malformed message arrays unchanged; parsing retains unknown until non-null object checks pass
Intercepts: 2
Recurrences: 0
Notes: Negative control: null body and null message tests throw TypeError before the guard, and all four shapes pass after validating the boundary.
---

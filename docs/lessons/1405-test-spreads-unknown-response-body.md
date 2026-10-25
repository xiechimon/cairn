---
Category: A test spread the GitHub port's unknown response body directly; the runtime test failed even though it compiled
Source: #1405 P4-0 (2026-10-24)
Level: 1
Safeguard: keep the `unknown` boundary on `GateRaw.body`; fixtures override fields through the typed `extra` parameter of `comparePages`; `pnpm typecheck` blocks spreading the unknown body
Intercepts: 1
Recurrences: 0
Notes: real negative control: spreading `res.body` reports TS2698; passing with the `extra` parameter did not widen the port type
---

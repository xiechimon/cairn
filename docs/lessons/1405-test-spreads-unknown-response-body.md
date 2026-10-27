---
Category: A test spread the GitHub port's unknown response body directly; it passed compilation but failed at runtime
Source: #1405 P4-0 (2026-10-24)
Level: 1
Safeguard: The unknown boundary of GateRaw.body is kept; fixtures override fields through comparePages's typed extra parameter; pnpm typecheck intercepts unknown-body spreads
Intercepts: 1
Recurrences: 0
Notes: Real negative control: spreading res.body errors TS2698; passing after switching to the extra parameter, without loosening the port type
---


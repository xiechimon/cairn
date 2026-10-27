---
Category: New code split a query called only once into a separate private function; `single-use-helper-gate` went red
Source: Dispatch dedup #1569/#1578 (2026-10-24)
Level: 2
Safeguard: `scripts/single-use-helper-gate.mjs` (shared by `pnpm prepush` and CI)
Intercepts: 2
Recurrences: 0
Notes: Negative control: the first version of `scripts/dispatch-agent.mjs` had 5 single-call functions like tempWorkdirs red, 0 after folding them into the exported `collectTicketSources`; turnedGreenSince in #1615's `retry-lessons.ts` was reported red, 0 after inlining
---


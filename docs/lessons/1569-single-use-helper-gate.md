---
Category: A new script split one-off queries into standalone private helpers; `single-use-helper-gate` reported 5
Source: dispatch dedup #1569/#1578 (2026-10-24)
Level: 2
Safeguard: `scripts/single-use-helper-gate.mjs` (shared by `pnpm prepush` and CI)
Intercepts: 2
Recurrences: 2
Notes: Negative control: the first `scripts/dispatch-agent.mjs` reported tempWorkdirs and 4 other single-call functions red; folded into the exported `collectTicketSources` it is 0. Recurred in #1514: readStepSession and exportBuild in `trajectory-export.ts` were committed without running prepush; review ran the gate and it went red, inlined into the export loop it is 0; the gate is already in prepush and CI and intercepting works, so no upgrade; Negative control: the first `scripts/dispatch-agent.mjs` reported tempWorkdirs and 4 other single-call functions red; folded into the exported `collectTicketSources` it is 0. Recurred in #1575: a migration test split readJournal and migrationsBeforeInvalidation into single-call private functions; the wrap-up gate run reported 2, inlined into the cases it is 0; the gate stopped it before commit, already the highest feasible machine-check level
---


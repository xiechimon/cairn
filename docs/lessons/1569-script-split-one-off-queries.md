---
Category: A new script split one-off queries into standalone private helpers; single-use-helper-gate reported 5
Source: dispatch dedup #1569/#1578 (2026-10-24)
Level: 2
Safeguard: `scripts/single-use-helper-gate.mjs` (shared by `pnpm prepush` and CI)
Intercepts: 5
Recurrences: 3
Notes: #1577 recurrence: place in `trajectory-curate.ts` and copiesIssueText in `trajectory-reflect.ts` were each called once, the gate reported 2 at wrap-up, inlining into the call loop left 0; the gate blocks before commit, already the highest feasible machine-check level, no upgrade. #1570 recurrence: the OTLP mapping module privatised traceIdOf, otlpValue, tokenCounts and 6 one-call functions, the gate reported 6 at wrap-up, inlining or folding them into an exported module left 0; design new modules around their export surface instead of splitting private one-off helpers. #1616 recurrence: the right-rail cost block was split into a one-call `CostGroup` component, the gate reported 1 at wrap-up, inlining left 0. #1404 S5a: the one-off `hungGithub` helper in a test went red, inlining into that test left 0. Negative control: the first `scripts/dispatch-agent.mjs` version's tempWorkdirs and 5 one-call helpers reported red; folding them into the exported `collectTicketSources` left 0
---


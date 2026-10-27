---
Category: The cost e2e fixture contradicted itself: all tokens 0 and model n/a, yet the cost was $0.92; the screenshot misled readers and the spec asserted nothing
Source: #1616 (2026-10-24)
Level: 2
Safeguard: `apps/web/e2e/ticket-cost.spec.ts` produces both `/api/builds/*/usage` and `usageCost` from one set of token_usage rows, and asserts the right rail shows the model name and token counts together
Intercepts: 0
Recurrences: 0
Notes: Negative control: making the usage endpoint return an empty array again turns the detail case red (model shows n/a next to $0.92); restored it is green
---


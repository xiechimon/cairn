---
Category: The cost e2e fixture contradicted itself: tokens all zero, model n/a, yet the cost was $0.92; the screenshot misled readers and the spec asserted nothing about it
Source: #1616 (2026-10-24)
Level: 2
Safeguard: `apps/web/e2e/ticket-cost.spec.ts` derives both `/api/builds/*/usage` and `usageCost` from the same token_usage rows, and asserts the right-rail model name and token count appear together on screen
Intercepts: 0
Recurrences: 0
Notes: negative control: reverting the usage endpoint to an empty array turns the detail case red (model shows n/a next to $0.92); green after restoring
---

---
Category: Server completion fixtures omitted the GitHub fetch port, so branch discovery called the public API and timed out before behavior assertions
Source: #1847 affected verification (2026-10-27)
Level: 2
Safeguard: step-claim-report.test.ts and delivery-surface.test.ts inject empty branch-list responses through the existing GitHub port while retaining the custom concurrent-claim probe
Intercepts: 5
Recurrences: 0
Notes: Negative controls: the unisolated claim timed out once and four delivery tests timed out at 5000 ms; the same assertions passed after injection, with four focused files passing 19 cases on the #1847 lane and both fixture files passing 12 cases on #1656. Production timeouts are unchanged
---

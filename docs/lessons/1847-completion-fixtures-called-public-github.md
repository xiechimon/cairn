---
Category: Server completion fixtures omitted the GitHub fetch port, so branch discovery called the public API and timed out before behavior assertions
Source: #1847 affected verification (2026-10-27)
Level: 2
Safeguard: step-claim-report.test.ts and delivery-surface.test.ts inject empty branch-list responses through the existing GitHub port while retaining the custom concurrent-claim probe; pr-reconcile.test.ts and pr-seg3.test.ts reject and assert zero global fetch calls around every test, inject a dedicated merge-gate spy into BuildDeps, and retain separate exact polling request and ETag assertions
Intercepts: 5
Recurrences: 0
Notes: Negative controls: the unisolated claim timed out once and four delivery tests timed out at 5000 ms; the same assertions passed after injection, with four focused files passing 19 cases on the #1847 lane and both fixture files passing 12 cases on #1656. On #2131, the same missing port reached merge-gate evaluation: the global-fetch assertions failed in all 11 selected cases before injection. Review caught a redundant isolation test and combined polling/gate counts. Dedicated gate spies now prove the fixture injection independently of the global-fetch hook; removing either fixture injection with the global assertion disabled makes its own regression fail. Polling counts retain their original exact values, and PR headers are filtered by their matching URL. Production timeouts are unchanged
---

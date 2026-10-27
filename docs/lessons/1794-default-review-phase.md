---
Category: A default Reviewer queued during the building phase reused the legacy review-to-replan path, so a valid blocking report persisted and then returned an illegal-phase conflict
Source: #1794 (2026-10-27)
Level: 2
Safeguard: `apps/server/test/merge-gate-product.test.ts` runs enrollment, server claim and a blocking machine completion in the default building-phase flow; it requires a successful response, a stored block and no queued plan
Intercepts: 1
Recurrences: 0
Notes: The real machine probe returned HTTP 409 after storing the block. The regression failed at expected 200 versus received 409; the phase guard persists the verdict and leaves legacy replanning to its valid review phase. Evidence is in docs/verify/1794/default-nogo-red.txt and default-nogo-green.txt.
---

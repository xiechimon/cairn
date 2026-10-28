---
Category: Merge-gate spoken safety answers were paired to review steps by creation-time index
Source: #1794 (2026-10-28)
Level: 2
Safeguard: REVIEW_VERDICT messages carry stepId; evaluateMergeGate binds answers by stepId; merge-gate-product.test.ts covers out-of-order finish
Intercepts: 0
Recurrences: 0
Notes: Negative control: first-created review finishes after a later review; positional pairing would attach the later review's gateLoosening:false and hide the first review's gateLoosening:true
---

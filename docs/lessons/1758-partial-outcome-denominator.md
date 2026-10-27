---
Category: Delivery change-failure metrics treated one negative and one unknown outcome signal as a known success
Source: PR #1787 source review (2026-10-28)
Level: 2
Safeguard: delivery-metrics.test.mjs requires a positive signal or two explicit negative signals before including a mature PR in the known failure-rate denominator
Intercepts: 1
Recurrences: 0
Notes: The new partial-negative control failed before implementation. Positive-plus-unknown and both-negative controls retain their intended results. All 28 delivery metrics controls pass after leaving partially unknown negatives in the missing-data count.
---

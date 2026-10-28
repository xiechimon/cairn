---
Category: A merge model admitted a review naming a head before that head existed
Source: #1811 / #2069 (2026-10-28)
Level: 2
Safeguard: P6_ReviewHeadWasObserved checks review-head causality while P1H retains a reachable older-head negative control; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: The unrestricted choice violates P6 after one review write. The corrected choice permits a previous head after an evidence-only push; the original head, digest and write bounds remain unchanged.
---

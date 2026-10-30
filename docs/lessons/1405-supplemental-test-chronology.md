---
Category: Supplemental helper tests were added after implementation during a test-first run
Source: #1405 (2026-10-30)
Level: 3
Safeguard: The evidence README explicitly separates preimplementation red controls from supplemental tests and records the chronology deviation
Intercepts: 0
Recurrences: 0
Notes: Review round 1 added supplemental invalid-input and API-retry assertions after the primary regression fixes; these are not claimed as test-first negative controls. The premature abandonment block was removed, its regression run red, and the block reapplied only after that result. Primary runtime regressions preceded implementation. Local unit-test output cannot establish historical authoring order; no automatic chronology claim is made for the supplemental tests. The existing test-first instruction remains the requirement.
---

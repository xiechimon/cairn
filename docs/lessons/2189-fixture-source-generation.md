---
Category: Generated test programs contained invalid newline escaping or selected the wrong CLI argument, masking the intended assertions
Source: Ticket 2189 review round 2 (2026-10-30)
Level: 2
Safeguard: Node suite executes generated programs and requires successful exit before checking statuses; setup fixtures inspect executed rule text rather than unexpanded shell variables
Intercepts: 0
Recurrences: 0
Notes: Intermediate failures are retained in red.log. Corrected generated programs run green. Existing test execution catches these errors; no additional prose-only rule was added.
---

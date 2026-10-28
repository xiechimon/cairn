---
Category: A real Git fixture silently skipped its merge when the runner had no commit identity
Source: PR #2073 repair of #2047 (2026-10-28)
Level: 2
Safeguard: The fixture passes its synthetic commit identity into the merge, requires successful merge and publication exits, and asserts the two expected merge parents
Intercepts: 0
Recurrences: 0
Notes: CI run 40640258633 and the isolated user.useConfigOnly control reproduce the missing containment log. The identical six-test control passes after the fixture repair. No product behavior or test expectation is weakened.
---

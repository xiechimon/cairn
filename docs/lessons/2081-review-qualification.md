---
Category: An operator treated a separate session as a different-model review and later used an arbitrary diff hash as the review digest
Source: #2081 (2026-10-28)
Level: 2
Safeguard: docs/verify/2081/review-preflight.py rejects same-family or incomplete reviews, post-merge timing, stale heads and noncanonical digests before the operator enables a merge; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: The actual post-merge #2081 record is a negative control. The #2082 pre-merge record is a positive control. This is an operator preflight, not a new GitHub or product merge gate. Model identity, process completion and repository digests are runtime facts, so static types cannot establish them.
---

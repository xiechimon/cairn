---
Category: Changing a reviewer model by global string replacement also changed model identifiers inside the source sent for review
Source: #2081 / #2082 review follow-up (2026-10-28)
Level: 2
Safeguard: docs/verify/2081/review-preflight.py compares every included changed text file with git show at the judged head and verifies the completed review input hash; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: Replaying the actual replacement against the complete #2082 input, even with its hash recomputed, fails source-byte comparison. Those model calls ended with zero usage and were never approvals. The producer now selects the reviewer only in its header and asserts unchanged full source before dispatch.
---

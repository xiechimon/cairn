---
Category: Empty legacy PR headings granted a Review waiver without satisfying the legacy contract
Source: #2196 (2026-10-30)
Level: 2
Safeguard: scripts/pr-evidence-gate.test.py rejects legacy waivers without an answered Upstream section and a visible Acceptance task; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: The supplied six-heading body returned GREEN before the fix and now names missing Review. Comment-only and fenced answers cannot grant the waiver. The runtime gate must examine body content because heading presence alone does not encode the old contract.
---

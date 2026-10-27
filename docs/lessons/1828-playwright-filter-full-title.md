---
Category: A start-anchored Playwright grep selected no cases because the full title includes the file name
Source: PR #1828 review (2026-10-28)
Level: 2
Safeguard: Playwright exits nonzero for an empty selection; the same corrected filter is collected with --list before the heavy control run
Intercepts: 1
Recurrences: 0
Notes: The original ^delete: filter exited with No tests found; the corrected delete substring collected all five repetitions before execution
---

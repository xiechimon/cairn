---
Category: A denominator disclaimer assertion did not detect an escape-rate claim in report output
Source: Issue 1956 (2026-10-28)
Level: 2
Safeguard: The CLI regression asserts the complete count-and-evidence report and rejects numeric percentages and count ratios
Intercepts: 0
Recurrences: 0
Notes: Injecting Escape rate 1/2 (50%) into the renderer fails the strengthened assertion while the denominator disclaimer remains present; see docs/verify/1956/rate-negative-control.log
---

---
Category: A refresh-expiry fix blocked a still-valid access token when the refresh clock was earlier
Source: #1845 (2026-10-27)
Level: 2
Safeguard: Expiry parsing tests cover a valid access clock after the refresh clock and use the later known clock
Intercepts: 1
Recurrences: 0
Notes: Negative control: docs/verify/1845/access-red.log records the earlier clock being selected
---

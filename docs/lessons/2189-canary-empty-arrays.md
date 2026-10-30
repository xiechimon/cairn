---
Category: Empty Bash arrays aborted HTTP-only probes under macOS Bash 3.2 nounset
Source: Ticket 2189 review round 2 (2026-10-30)
Level: 2
Safeguard: Bash 3.2 regression runs anonymous and forged-header requests with empty paths and login arrays and multiple HTTP/HTTPS endpoints
Intercepts: 0
Recurrences: 0
Notes: The old canary fails the HTTP-only regression in red.log; green.log records the corrected shell run. The URL expression was also corrected after the fixture rejected valid HTTP endpoints.
---

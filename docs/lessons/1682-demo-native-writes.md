---
Category: Machine detail actions bypassed the demo API-client write guard through native fetch
Source: PR #1769 review and browser reproduction (2026-10-28)
Level: 2
Safeguard: Browser tests drive machine evacuation and deletion against the compiled demo and assert the notice, unchanged data, and zero backend traffic
Intercepts: 2
Recurrences: 0
Notes: Both tests failed before the handler guards. The failed traces show an actual POST and DELETE returning 404 from the backend-free static server. The same tests pass after guards execute before fetch or pending state changes. The spare-machine fixture exercises the user-reachable deletion path without changing disabled controls.
---

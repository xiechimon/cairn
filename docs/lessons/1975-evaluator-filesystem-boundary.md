---
Category: Environment filtering left publication credentials reachable by absolute filesystem paths
Source: PR #2067 review round 2 (2026-10-28)
Level: 1
Safeguard: Required Bubblewrap mount and PID namespaces separate evaluation from authenticated publication and mount publication Git metadata read-only
Intercepts: 0
Recurrences: 0
Notes: The credential probe failed under direct Node execution and passed inside the namespace; the Git configuration injection probe also went red before the read-only mount and green afterward
---

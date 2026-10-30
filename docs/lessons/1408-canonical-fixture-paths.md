---
Category: Deployment assertions compared canonical and noncanonical temporary paths
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: Deployment fixtures canonicalize the temporary root before constructing expected symlink targets
Intercepts: 0
Recurrences: 0
Notes: The initial post-implementation fixture run rejected equivalent macOS /var and /private/var paths; extended-red.log and green.log preserve the regression sequence. API fixture pagination was also corrected to match gh --slurp pages.
---

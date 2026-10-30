---
Category: Setup validated symlinks and leaf types but could mutate accounts when a required ancestor was a regular file
Source: Ticket 2189 (2026-10-30)
Level: 2
Safeguard: validate_path rejects every existing non-directory ancestor before mutations; setup fixtures replace the owner configuration directory with a regular file and assert no groups are created
Intercepts: 0
Recurrences: 0
Notes: The review-round implementation returned success for the invalid ancestor under both firewall backends in the appended red.log. The corrected validator fails before identity changes; host races with a privileged concurrent mutator remain outside this static preflight guarantee.
---

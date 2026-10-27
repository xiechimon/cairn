---
Category: Runtime directory exemptions hid forbidden procfs and sysfs read attempts from grading
Source: PR #2018 round 2 review (2026-10-27)
Level: 2
Safeguard: Real subprocess controls require violations and failed grades for procfs root aliases and non-probe procfs and sysfs reads alongside a passing oracle; runtime probes use exact path matches
Intercepts: 1
Recurrences: 0
Notes: round2-red.log records seven failures on the broad exemptions; round2-green.log runs the same controls successfully after exact-path classification, while the real node --test control still passes
---

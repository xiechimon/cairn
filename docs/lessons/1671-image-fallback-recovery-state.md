---
Category: Image fallback state did not follow rebuilt sessions or progress across network retries
Source: #1671 reviewed delivery of PR #1928 (2026-10-28)
Level: 2
Safeguard: Runner integration tests require lost-session image rejection to retry the complete task, rebuilt text-only images to upload a notice, and prior-pass progress to prevent a fresh retry; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: reviewed-integration-before.log records two failing assertions and reviewed-resume-notice-before.log records the missing notice; reviewed-related-green.log passes all three among 409 tests. A type alone cannot enforce progress lifetime across attempts or bind a rebuilt prompt to the session image state, so real runner regressions are the strongest small safeguard.
---

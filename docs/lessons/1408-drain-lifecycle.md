---
Category: Deployment drain recovery depended on triggers that migrations could drop and never expired
Source: Ticket 1408 review round 1 (2026-10-30)
Level: 2
Safeguard: Transactional pause restoration commits before idempotent trigger cleanup; deadline predicates and authenticated server readiness before barrier reinstallation and daemon restart bound the barrier
Intercepts: 0
Recurrences: 0
Notes: red.log exercises rebuilt step tables, expired claims, concurrent pause changes, cleanup failure and interrupted drain; readiness-red.log also catches systemd returning before migration completes; green.log verifies recovery
---

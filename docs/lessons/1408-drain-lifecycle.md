---
Category: Deployment drain recovery depended on triggers that migrations could drop and never expired
Source: Ticket 1408 review round 1 (2026-10-30)
Level: 1
Safeguard: Barrier installation renews its deadline atomically with trigger recreation; server readiness precedes reinstallation and daemon restart; SIGHUP and SIGTERM share the cleanup handler; since 2026-10-30
Intercepts: 0
Recurrences: 1
Notes: Round 2 red controls expose missing SIGHUP cleanup and stale deadlines after slow readiness; green.log verifies renewal and signal cleanup. Earlier transactional pause restoration and expiry regressions remain covered.
---

---
Category: Restoring a deployment backup reinstated its paused teams and claim barrier
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: Confirmed restore clears saved deployment drain state before restarting and a drained-snapshot regression asserts triggers and saved state are absent
Intercepts: 0
Recurrences: 0
Notes: restore-barrier-red.log records the original persisted-barrier failure. Deployment backups intentionally capture the drained state; restore now resumes its saved pause values. Green output is in green.log.
---

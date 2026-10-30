---
Category: Deployment accepted an unbuilt daemon and a heartbeat from an old release
Source: Ticket 1408 host findings (2026-10-30)
Level: 2
Safeguard: Package build and contained CLI artifact gate precede drain; MainPID cwd checks gate health for both services
Intercepts: 0
Recurrences: 0
Notes: Round 3 red.log rejects the original deployment in eleven cases; green.log exercises build refusal and process provenance rollback using stubbed systemd and procfs boundaries. Real host acceptance remains required
---

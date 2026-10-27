---
Category: Evidence screenshots taken while an entry animation was still running showed a half-transparent overlay
Source: #1937 (2026-10-27)
Level: 2
Safeguard: `shot()` in `apps/web/e2e/task-panel.spec.ts` waits for every finite animation before `evidenceShot`
Intercepts: 1
Recurrences: 0
Notes: Infinite animations (spinners) are skipped so the wait cannot hang
---

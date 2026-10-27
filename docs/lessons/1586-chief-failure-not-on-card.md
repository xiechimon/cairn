---
Category: Chief failures were only written as session messages; the card had no failure-reason read surface
Source: #1586 (2026-10-24)
Level: 2
Safeguard: `chief-context-failure.test.ts` covers finishStep to the thread API and no notification on failure; `chief-orchestration-failure.test.ts` verifies the real card renders the failure reason and retry
Intercepts: 1
Recurrences: 0
Notes: Negative control: after reporting context_length_exceeded the API lacked lastTurnError and the card lacked the orchestration failure; green after completing the projection, with the running and failed states sharing the thread data source
---

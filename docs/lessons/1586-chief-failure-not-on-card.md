---
Category: A chief failure only wrote a conversation message; the card had no surface to read the failure reason from
Source: #1586 (2026-10-24)
Level: 2
Safeguard: `chief-context-failure.test.ts` covers finishStep through the thread API and no notification on failure; `chief-orchestration-failure.test.ts` verifies the real card renders the failure reason and the retry
Intercepts: 1
Recurrences: 0
Notes: negative control: after the context_length_exceeded report the API lacked lastTurnError and the card lacked the orchestration failure; green after filling the projection, with the running and failed states sharing the thread data source
---

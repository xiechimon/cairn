---
Category: To get failure refreshes onto the minimized panel cards, a chief_message team notification was added on chief failure, breaking the existing convention "no notification on failure; failures go through the system row + toast"
Source: #1586 (2026-10-24)
Level: 2
Safeguard: the existing `m4a-chief-loop.test.ts` pins that failures produce no chief_message notification; `chief-context-failure.test.ts` now asserts no notification events on failure; the card gets lastTurnError via `useChiefThreads` polling every 3 seconds while a turn is in flight, and the e2e no longer fakes a notification event
Intercepts: 1
Recurrences: 0
Notes: real negative control: with the added notification both tests went red (chief_message row count 1, expected 0); removing the notification and switching to polling turned them green, and prepush was first blocked by this existing test
---

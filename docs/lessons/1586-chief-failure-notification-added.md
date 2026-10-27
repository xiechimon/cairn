---
Category: To give the minimized panel's card failure refreshes, a chief_message team notification was added on chief failure, violating the existing convention "no notification on failure; failure goes through the system row + toast"
Source: #1586 (2026-10-24)
Level: 2
Safeguard: The existing `m4a-chief-loop.test.ts` pins no chief_message notification on failure; `chief-context-failure.test.ts` now asserts no notification event on failure; the card gets lastTurnError via `useChiefThreads` polling every 3 seconds while a turn is in flight, so e2e no longer fakes a notification event
Intercepts: 1
Recurrences: 0
Notes: Real negative control: under the implementation with the new notification both tests went red (chief_message rows 1, expected 0); green after removing the notification and switching to polling; prepush was also first intercepted by this existing test
---


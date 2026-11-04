---
Category: Merging network fallback with chief turns parked a rate-limited chief under an empty provider id
Source: PR #1842 reconciliation (2026-10-28)
Level: 2
Safeguard: chief-queue-steer-stop.test.ts checks the persisted provider and prevents immediate reclaim after a chief capacity failure without a backup
Intercepts: 1
Recurrences: 0
Notes: The new integration test first failed with an empty provider where relay-a was expected; the capacity path now resolves the chief agent as well as worker agents
---

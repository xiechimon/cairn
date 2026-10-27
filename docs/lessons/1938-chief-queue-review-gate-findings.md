---
Category: The chief queue shipped three edge cases that the self review missed and the independent review gate caught: same-millisecond turns claimed by random id instead of arrival order, a steered message still withdrawable after its text was handed to the daemon, and a runtime check that compared "is a backend runtime" booleans so claude-code could fall back to gemini
Source: #1938 (2026-10-27)
Level: 2
Safeguard: `apps/server/test/chief-queue-steer-stop.test.ts` cases "turns created in the same millisecond run in arrival order", "a steered message can no longer be withdrawn" and "a backup model on a different backend runtime is skipped too"
Intercepts: 1
Recurrences: 0
Notes: Negative control: all three cases were written first and went red on the head the gate blocked (claimed `turn-a` instead of `turn-z`; withdraw returned 200; fallback row set), green after the fix. Pattern to check next time: any ordering key must match the one the UI shows, any state that has left the server must not be undoable, and identity checks must compare the identity, not a category flag
---

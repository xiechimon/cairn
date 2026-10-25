---
Category: The drive script counted before waiting for the element to appear, judged 0 masked rows before they rendered, then guessed "screenshot mask parameter" and changed a round before isolating the real cause
Source: #1478 (2026-10-24)
Level: 2
Safeguard: the `drive.mjs` api-key probe waits for the masked rows before counting; counting without waiting ran red 4 of 10 times on a fresh stack (flaky), 5 out of 5 PASS after adding the wait; a flaky mistake makes no deterministic negative control
Intercepts: 0
Recurrences: 0
Notes: guessing a cause before isolating is a judgment error no machine can block; the blockable half is the probe counting without waiting
---

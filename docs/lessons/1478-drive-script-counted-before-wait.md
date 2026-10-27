---
Category: A drive script called `count()` before waiting for the element, so it counted 0 masked rows before they rendered; it then first guessed "the screenshot mask parameter caused it" and spent a round changing that before isolating the real cause
Source: #1478 (2026-10-24)
Level: 2
Safeguard: The `drive.mjs` api-key probe `waitFor`s the masked row before counting; counting without waiting went red 4 of 10 runs on a fresh stack (intermittent), and with the wait all 5 runs PASS; an intermittent mistake cannot be a deterministic negative control
Intercepts: 0
Recurrences: 0
Notes: Changing things on a guessed cause is a judgment error no machine can stop; the stoppable half is a probe that counts without waiting
---


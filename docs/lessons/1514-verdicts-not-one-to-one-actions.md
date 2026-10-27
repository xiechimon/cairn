---
Category: Export verdicts did not map one-to-one to persisted actions: confirm and approve were missed first, then actions were driven by side, marking the review gate's revision as restart
Source: #1514 (2026-10-24)
Level: 1
Safeguard: Actions are taken directly from the build_feedback.kind column; the exporter no longer maps side to action; the diff contract takes revision; `trajectory-export.test.ts` asserts structured rejection, gate-crossing declarations with an actor, gate_verdict, the build-side revision kept separate from restart, and inserts a same-text declaration with an empty actor to assert it does not enter the verdict
Intercepts: 2
Recurrences: 1
Notes: Negative control: the old export missed confirm/approve; on recurrence the old export emitted the build-side revision as restart, the test went red, passing after taking kind
---


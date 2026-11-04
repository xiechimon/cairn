---
Category: A verifier's online-probe failure path wrote reward 0 but exited the probe with status 0, so the script continued into pytest and overwrote the failure record with a pass; an online scoring container would have scored 1
Source: #1681 (2026-10-26)
Level: 2
Safeguard: `integration/test/harbor-offline-score.test.ts` asserts the probe exits nonzero (`raise SystemExit(1)`) before pytest; the live rerun of the offline job scores 1.0 with the fixed script
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old `raise SystemExit(0)` script fails the `SystemExit\(1\)` assertion and would silently pass online scoring
---

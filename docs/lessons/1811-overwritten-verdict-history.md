---
Category: A merge-gate model overwrote verdict history and erased an earlier blocking verdict
Source: #1811 / #2069 (2026-10-28)
Level: 2
Safeguard: P5_RepeatedVerdictRemainsBlocked model-checks a verify block followed by a verify pass on the same digest; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: The unchanged four-write bound admits the real mistake. The original slot model violates P5; the retained-row model passes P5 and all original controls without weakening their properties.
---
